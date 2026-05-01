import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { spawn } from 'node:child_process'
import { networkInterfaces, homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { ErrorCodes } from '../../shared/contracts/error-codes.js'
import { errorResponse, okResponse, ServiceResponse } from '../../shared/contracts/response.js'
import type { Gateway } from '../../shared/types/entities.js'
import { AppSettingsRepository } from '../../db/repositories/workspace-repo.js'
import { GatewayRepository } from '../../db/repositories/gateway-repo.js'
import { AuthService } from './auth.service.js'
import { TaskService } from './task.service.js'
import { electronRuntime } from '../utils/electron-runtime.js'
import type { InstallMcpClientRequest } from '../../shared/contracts/ipc.js'
import { safeConsole } from '../utils/safe-output.js'

const ACTIVE_GATEWAY_KEY = 'activeGatewayId'
const MCP_SERVER_NAME = 'openmissioncontrol'

type McpSetupInfo = {
  bridgeUrl: string
  lanUrls: string[]
  scriptPath: string
  codexConfigPath: string
  claudeDesktopConfigPath: string
  commands: {
    codex: string
    claudeDesktopRestart: string
  }
  snippets: {
    codexToml: string
    claudeDesktopJson: string
  }
}

type McpStdioProbeInfo = {
  ok: boolean
  durationMs: number
  initializeOk: boolean
  toolsListOk: boolean
  toolCount?: number
  error?: string
}

type McpStatusInfo = {
  available: boolean
  name: string
  bridgeUrl: string | null
  checkedAt: string
  startedAt: string | null
  message: string
  bridgeAvailable?: boolean
  stdioProbe?: McpStdioProbeInfo
  error?: string
}

function sanitizeLogValue(value: unknown): unknown {
  const seen = new WeakSet<object>()
  const sensitiveKeys = new Set(['authorization', 'token', 'actortoken', 'bridgetoken', 'password'])
  try {
    const json = JSON.stringify(value, (key, rawValue) => {
      if (sensitiveKeys.has(key.toLowerCase())) return '[redacted]'
      if (rawValue && typeof rawValue === 'object') {
        if (seen.has(rawValue)) return '[circular]'
        seen.add(rawValue)
      }
      return rawValue
    })
    if (!json) return value
    if (json.length > 8000) return `${json.slice(0, 8000)}... [truncated]`
    return JSON.parse(json)
  } catch {
    return '[unserializable]'
  }
}

function logMcpBridgeEvent(event: string, data: Record<string, unknown>): void {
  safeConsole.info(`[mcp-bridge] ${event}`, sanitizeLogValue(data))
}

function readRequestBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
    request.on('error', reject)
    request.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      if (!raw.trim()) return resolve({})
      try {
        resolve(JSON.parse(raw) as Record<string, unknown>)
      } catch (error) {
        reject(error)
      }
    })
  })
}

function sendJson(response: ServerResponse, statusCode: number, value: unknown): void {
  response.statusCode = statusCode
  response.setHeader('content-type', 'application/json; charset=utf-8')
  response.end(JSON.stringify(value))
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

function localIpv4Addresses(): string[] {
  const addresses: string[] = []
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === 'IPv4' && !entry.internal) addresses.push(entry.address)
    }
  }
  return [...new Set(addresses)]
}

function userDataDir(): string {
  return electronRuntime.app?.getPath('userData') ?? join(homedir(), '.openmissioncontrol')
}

function codexConfigPath(): string {
  return join(homedir(), '.codex', 'config.toml')
}

function claudeDesktopConfigPath(): string {
  if (process.platform === 'darwin') return join(homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json')
  if (process.platform === 'win32') return join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'Claude', 'claude_desktop_config.json')
  return join(homedir(), '.config', 'Claude', 'claude_desktop_config.json')
}

function mcpScriptPath(): string {
  return join(userDataDir(), 'mcp', 'openmissioncontrol-mcp-server.mjs')
}

function mcpModuleRoot(): string {
  return electronRuntime.app?.getAppPath?.() ?? process.cwd()
}

function codexTomlBlock(scriptPath: string, bridgeUrl: string, token: string): string {
  return [
    `[mcp_servers.${MCP_SERVER_NAME}]`,
    'command = "node"',
    `args = [${JSON.stringify(scriptPath)}]`,
    'enabled = true',
    'startup_timeout_sec = 120',
    '[mcp_servers.openmissioncontrol.env]',
    `OMC_MCP_BRIDGE_URL = ${JSON.stringify(bridgeUrl)}`,
    `OMC_MCP_TOKEN = ${JSON.stringify(token)}`,
    `OMC_MCP_MODULE_ROOT = ${JSON.stringify(mcpModuleRoot())}`
  ].join('\n')
}

function codexInstallCommand(path: string, block: string): string {
  const quotedPath = shellQuote(path)
  return [
    `mkdir -p ${shellQuote(dirname(path))}`,
    `touch ${quotedPath}`,
    `# Open Mission Control updates only its own [mcp_servers.${MCP_SERVER_NAME}] block.`,
    `# Use the app Settings install button to replace stale bridge URLs/tokens safely.`,
    `cat <<'TOML'`,
    block,
    'TOML'
  ].join('\n')
}

function tomlSectionName(line: string): string | null {
  const match = line.match(/^\s*\[([^\]]+)\]\s*(?:#.*)?$/)
  return match ? match[1].trim() : null
}

function isCodexMcpSection(sectionName: string): boolean {
  return sectionName === `mcp_servers.${MCP_SERVER_NAME}` || sectionName.startsWith(`mcp_servers.${MCP_SERVER_NAME}.`)
}

function codexMcpBlockRange(value: string): { start: number; end: number } | null {
  const lines = value.match(/[^\n]*(?:\n|$)/g) ?? []
  let offset = 0
  let start = -1
  let end = value.length

  for (const line of lines) {
    if (!line) break
    const sectionName = tomlSectionName(line)
    if (sectionName) {
      if (start === -1 && isCodexMcpSection(sectionName)) {
        start = offset
      } else if (start !== -1 && !isCodexMcpSection(sectionName)) {
        end = offset
        break
      }
    }
    offset += line.length
  }

  return start === -1 ? null : { start, end }
}

function claudeDesktopServerConfig(scriptPath: string, bridgeUrl: string, token: string): Record<string, unknown> {
  return {
    command: 'node',
    args: [scriptPath],
    env: {
      OMC_MCP_BRIDGE_URL: bridgeUrl,
      OMC_MCP_TOKEN: token,
      OMC_MCP_MODULE_ROOT: mcpModuleRoot()
    }
  }
}

function mcpServerScript(): string {
  return `#!/usr/bin/env node
const bridgeUrl = process.env.OMC_MCP_BRIDGE_URL;
const bridgeToken = process.env.OMC_MCP_TOKEN;

if (!bridgeUrl || !bridgeToken) {
  console.error('Open Mission Control MCP environment is missing.');
  process.exit(1);
}

let buffer = Buffer.alloc(0);

function writeMessage(message) {
  const body = Buffer.from(JSON.stringify(message), 'utf8');
  process.stdout.write('Content-Length: ' + body.length + '\\r\\n\\r\\n');
  process.stdout.write(body);
}

function tool(name, description, properties, required = []) {
  return { name, description, inputSchema: { type: 'object', properties, required, additionalProperties: true } };
}

const jsonSchema = {
  type: 'object',
  description: 'Task JSON matching Open Mission Control import format. Root fields include title, description, status, tags, checklist, comments, customFields, and subtasks.'
};

const tools = [
  tool('omc_get_task_context', 'Read one Open Mission Control project and task planning context.', {
    projectId: { type: 'string' },
    taskId: { type: 'string' }
  }, ['projectId', 'taskId']),
  tool('omc_validate_task_json', 'Validate and normalize one task JSON object without writing.', {
    projectId: { type: 'string' },
    taskId: { type: 'string' },
    json: jsonSchema
  }, ['json']),
  tool('omc_create_task_from_json', 'Create a task in an Open Mission Control project from one task JSON object.', {
    projectId: { type: 'string' },
    json: jsonSchema
  }, ['projectId', 'json']),
  tool('omc_update_task_from_json', 'Update an existing Open Mission Control task from one task JSON object.', {
    taskId: { type: 'string' },
    json: jsonSchema
  }, ['taskId', 'json']),
  tool('omc_mark_task_ready_for_review', 'Mark one completed Codex task and all subtasks ready for review, then close its Codex terminal session.', {
    projectId: { type: 'string' },
    taskId: { type: 'string' }
  }, ['taskId'])
];

const protocolVersion = '2024-11-05';
const serverInfo = { name: 'openmissioncontrol', version: '0.1.0' };
const emptyResources = [];
const emptyResourceTemplates = [];
const emptyPrompts = [];

async function callBridge(toolName, args) {
  const response = await fetch(bridgeUrl + '/tool', {
    method: 'POST',
    headers: {
      authorization: 'Bearer ' + bridgeToken,
      'content-type': 'application/json'
    },
    body: JSON.stringify({ tool: toolName, arguments: args || {} })
  });
  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { error: text || 'Invalid bridge response' };
  }
  if (!response.ok || payload.ok === false) {
    const message = payload.error?.message || payload.error || 'Open Mission Control bridge call failed.';
    throw new Error(message);
  }
  return payload.data ?? payload;
}

async function handle(message) {
  if (!message || typeof message !== 'object') return;
  if (message.method === 'initialize') {
    writeMessage({
      jsonrpc: '2.0',
      id: message.id,
      result: {
        protocolVersion,
        capabilities: {
          tools: {},
          resources: {},
          prompts: {}
        },
        serverInfo
      }
    });
    return;
  }
  if (message.method === 'notifications/initialized') return;
  if (message.method === 'ping') {
    writeMessage({ jsonrpc: '2.0', id: message.id, result: {} });
    return;
  }
  if (message.method === 'tools/list') {
    writeMessage({ jsonrpc: '2.0', id: message.id, result: { tools } });
    return;
  }
  if (message.method === 'tools/call') {
    try {
      const name = message.params?.name;
      const args = message.params?.arguments || {};
      const data = await callBridge(name, args);
      writeMessage({
        jsonrpc: '2.0',
        id: message.id,
        result: { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
      });
    } catch (error) {
      writeMessage({
        jsonrpc: '2.0',
        id: message.id,
        result: {
          isError: true,
          content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }]
        }
      });
    }
    return;
  }
  if (message.method === 'resources/list') {
    writeMessage({ jsonrpc: '2.0', id: message.id, result: { resources: emptyResources } });
    return;
  }
  if (message.method === 'resources/templates/list') {
    writeMessage({ jsonrpc: '2.0', id: message.id, result: { resourceTemplates: emptyResourceTemplates } });
    return;
  }
  if (message.method === 'prompts/list') {
    writeMessage({ jsonrpc: '2.0', id: message.id, result: { prompts: emptyPrompts } });
    return;
  }
  if (message.method === 'completion/complete') {
    writeMessage({ jsonrpc: '2.0', id: message.id, result: { completion: { values: [], total: 0, hasMore: false } } });
    return;
  }
  if (message.id !== undefined) {
    writeMessage({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Method not found' } });
  }
}

function pump() {
  while (true) {
    const headerEnd = buffer.indexOf('\\r\\n\\r\\n');
    if (headerEnd < 0) return;
    const header = buffer.slice(0, headerEnd).toString('utf8');
    const match = /content-length:\\s*(\\d+)/i.exec(header);
    if (!match) {
      buffer = Buffer.alloc(0);
      return;
    }
    const length = Number(match[1]);
    const bodyStart = headerEnd + 4;
    const bodyEnd = bodyStart + length;
    if (buffer.length < bodyEnd) return;
    const body = buffer.slice(bodyStart, bodyEnd).toString('utf8');
    buffer = buffer.slice(bodyEnd);
    try {
      void handle(JSON.parse(body));
    } catch {}
  }
}

process.stdin.on('data', (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  pump();
});
console.error('Open Mission Control MCP server ready.');
`
}

function encodeMcpMessage(message: Record<string, unknown>): Buffer {
  const body = Buffer.from(JSON.stringify(message), 'utf8')
  return Buffer.concat([
    Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, 'utf8'),
    body
  ])
}

function parseMcpMessages(buffer: Buffer): { messages: Array<Record<string, unknown>>; rest: Buffer } {
  const messages: Array<Record<string, unknown>> = []
  let current = buffer
  while (true) {
    const headerEnd = current.indexOf('\r\n\r\n')
    if (headerEnd < 0) return { messages, rest: current }
    const header = current.slice(0, headerEnd).toString('utf8')
    const match = /content-length:\s*(\d+)/i.exec(header)
    if (!match) return { messages, rest: Buffer.alloc(0) }
    const length = Number(match[1])
    const bodyStart = headerEnd + 4
    const bodyEnd = bodyStart + length
    if (current.length < bodyEnd) return { messages, rest: current }
    const body = current.slice(bodyStart, bodyEnd).toString('utf8')
    current = current.slice(bodyEnd)
    try {
      const parsed = JSON.parse(body)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) messages.push(parsed as Record<string, unknown>)
    } catch {}
  }
}

async function probeMcpStdio(scriptPath: string, bridgeUrl: string, token: string): Promise<McpStdioProbeInfo> {
  const startedAt = Date.now()
  return new Promise((resolve) => {
    const child = spawn('node', [scriptPath], {
      env: {
        ...process.env,
        OMC_MCP_BRIDGE_URL: bridgeUrl,
        OMC_MCP_TOKEN: token,
        OMC_MCP_MODULE_ROOT: mcpModuleRoot()
      },
      stdio: ['pipe', 'pipe', 'pipe']
    })
    let stdout = Buffer.alloc(0)
    let stderr = ''
    let initializeOk = false
    let toolsListOk = false
    let toolCount: number | undefined
    let finished = false

    const finish = (ok: boolean, error?: string) => {
      if (finished) return
      finished = true
      clearTimeout(timeout)
      child.kill('SIGTERM')
      const result: McpStdioProbeInfo = {
        ok,
        durationMs: Date.now() - startedAt,
        initializeOk,
        toolsListOk,
        ...(toolCount === undefined ? {} : { toolCount }),
        ...(error ? { error } : {})
      }
      logMcpBridgeEvent('stdio-probe', result)
      resolve(result)
    }

    const timeout = setTimeout(() => {
      finish(false, `MCP stdio handshake timed out after 2000ms.${stderr.trim() ? ` stderr: ${stderr.trim().slice(0, 500)}` : ''}`)
    }, 2_000)

    child.once('error', (error) => finish(false, error.message))
    child.stderr.on('data', (chunk) => {
      stderr += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk)
    })
    child.stdout.on('data', (chunk) => {
      stdout = Buffer.concat([stdout, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)])
      const parsed = parseMcpMessages(stdout)
      stdout = parsed.rest
      for (const message of parsed.messages) {
        if (message.id === 1 && message.result && typeof message.result === 'object') initializeOk = true
        if (message.id === 2 && message.result && typeof message.result === 'object') {
          toolsListOk = true
          const tools = (message.result as Record<string, unknown>).tools
          toolCount = Array.isArray(tools) ? tools.length : undefined
        }
      }
      if (initializeOk && toolsListOk) finish(true)
    })

    const initialize = {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'openmissioncontrol-probe', version: '0.1.0' }
      }
    }
    const initialized = { jsonrpc: '2.0', method: 'notifications/initialized', params: {} }
    const toolsList = { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }
    child.stdin.write(encodeMcpMessage(initialize))
    child.stdin.write(encodeMcpMessage(initialized))
    child.stdin.write(encodeMcpMessage(toolsList))
  })
}

async function upsertCodexBlock(path: string, block: string): Promise<void> {
  let current = ''
  try {
    current = await readFile(path, 'utf8')
  } catch {}
  const existing = codexMcpBlockRange(current)
  const next = existing
    ? `${current.slice(0, existing.start).trimEnd()}${existing.start > 0 ? '\n\n' : ''}${block}\n${current.slice(existing.end).trimStart()}`
    : `${current.trimEnd()}${current.trim() ? '\n\n' : ''}${block}\n`
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, next, 'utf8')
}

async function upsertClaudeDesktopConfig(path: string, serverConfig: Record<string, unknown>): Promise<void> {
  let root: Record<string, unknown> = {}
  try {
    const raw = await readFile(path, 'utf8')
    root = raw.trim() ? JSON.parse(raw) as Record<string, unknown> : {}
  } catch {}
  const servers = root.mcpServers && typeof root.mcpServers === 'object' && !Array.isArray(root.mcpServers)
    ? root.mcpServers as Record<string, unknown>
    : {}
  root.mcpServers = { ...servers, [MCP_SERVER_NAME]: serverConfig }
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(root, null, 2)}\n`, 'utf8')
}

export class AppSettingsService {
  private mcpServer?: Server
  private mcpPort?: number
  private mcpStartedAt?: Date

  constructor(
    private readonly auth: AuthService,
    private readonly repo: AppSettingsRepository,
    private readonly gateways: GatewayRepository,
    private readonly tasks: TaskService
  ) {}

  async getActiveGateway(payload: { actorToken?: string }): Promise<ServiceResponse<{ gatewayId: string | null; gateway?: Gateway | null }>> {
    const actor = await this.auth.requireActor(payload?.actorToken)
    const gatewayId = await this.repo.get<string | null>(actor.user.organizationId, ACTIVE_GATEWAY_KEY)
    if (!gatewayId) return okResponse({ gatewayId: null, gateway: null })
    const gateway = await this.gateways.get(gatewayId)
    if (!gateway || gateway.organizationId !== actor.user.organizationId) {
      await this.repo.set(actor.user.organizationId, ACTIVE_GATEWAY_KEY, null)
      return okResponse({ gatewayId: null, gateway: null })
    }
    return okResponse({ gatewayId, gateway })
  }

  async setActiveGateway(payload: { actorToken?: string; gatewayId?: string | null }): Promise<ServiceResponse<{ gatewayId: string | null; gateway?: Gateway | null }>> {
    const actor = await this.auth.requireActor(payload?.actorToken)
    const gatewayId = payload.gatewayId || null
    if (!gatewayId) {
      await this.repo.set(actor.user.organizationId, ACTIVE_GATEWAY_KEY, null)
      return okResponse({ gatewayId: null, gateway: null })
    }
    const gateway = await this.gateways.get(gatewayId)
    if (!gateway) return errorResponse(ErrorCodes.NotFound, 'Gateway not found')
    if (gateway.organizationId !== actor.user.organizationId) return errorResponse(ErrorCodes.Forbidden, 'Access denied')
    await this.repo.set(actor.user.organizationId, ACTIVE_GATEWAY_KEY, gateway.id)
    return okResponse({ gatewayId: gateway.id, gateway })
  }

  private async ensureMcpBridge(): Promise<number> {
    if (this.mcpPort && this.mcpServer?.listening) return this.mcpPort
    const server = createServer(async (request, response) => {
      const requestStartedAt = Date.now()
      logMcpBridgeEvent('http-request', {
        method: request.method,
        url: request.url,
        remoteAddress: request.socket.remoteAddress
      })
      try {
        if (request.method !== 'GET' && request.method !== 'POST') {
          sendJson(response, 405, { ok: false, error: { message: 'Method not allowed' } })
          logMcpBridgeEvent('http-response', {
            method: request.method,
            url: request.url,
            statusCode: 405,
            ok: false,
            durationMs: Date.now() - requestStartedAt
          })
          return
        }
        if (request.method === 'GET' && request.url === '/health') {
          sendJson(response, 200, { ok: true, data: { name: MCP_SERVER_NAME } })
          logMcpBridgeEvent('http-response', {
            method: request.method,
            url: request.url,
            statusCode: 200,
            ok: true,
            durationMs: Date.now() - requestStartedAt
          })
          return
        }
        if (request.method !== 'POST' || request.url !== '/tool') {
          sendJson(response, 404, { ok: false, error: { message: 'Not found' } })
          logMcpBridgeEvent('http-response', {
            method: request.method,
            url: request.url,
            statusCode: 404,
            ok: false,
            durationMs: Date.now() - requestStartedAt
          })
          return
        }
        const authHeader = request.headers.authorization ?? ''
        const token = typeof authHeader === 'string' && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
        if (!token || !(await this.auth.getSessionActor(token))) {
          sendJson(response, 401, { ok: false, error: { message: 'Unauthorized' } })
          logMcpBridgeEvent('http-response', {
            method: request.method,
            url: request.url,
            statusCode: 401,
            ok: false,
            durationMs: Date.now() - requestStartedAt
          })
          return
        }
        const body = await readRequestBody(request)
        const tool = typeof body.tool === 'string' ? body.tool : ''
        const args = body.arguments && typeof body.arguments === 'object' && !Array.isArray(body.arguments)
          ? body.arguments as Record<string, unknown>
          : {}
        const startedAt = Date.now()
        logMcpBridgeEvent('tool-request', {
          tool,
          arguments: args,
          remoteAddress: request.socket.remoteAddress
        })
        const json = Object.prototype.hasOwnProperty.call(args, 'json') ? args.json : args
        const projectId = typeof args.projectId === 'string' ? args.projectId : undefined
        const taskId = typeof args.taskId === 'string' ? args.taskId : undefined
        let result: ServiceResponse<unknown>
        if (tool === 'omc_get_task_context') {
          result = await this.tasks.plannerContext({ actorToken: token, projectId, taskId })
        } else if (tool === 'omc_validate_task_json') {
          result = await this.tasks.plannerValidateJson({ actorToken: token, projectId, taskId, json })
        } else if (tool === 'omc_create_task_from_json') {
          result = await this.tasks.plannerCreateFromJson({ actorToken: token, projectId, taskId, json })
        } else if (tool === 'omc_update_task_from_json') {
          result = await this.tasks.plannerUpdateFromJson({ actorToken: token, projectId, taskId, json })
        } else if (tool === 'omc_mark_task_ready_for_review') {
          result = await this.tasks.markTaskReadyForReview({ actorToken: token, projectId, taskId })
        } else {
          sendJson(response, 400, { ok: false, error: { message: `Unknown OMC MCP tool: ${tool}` } })
          logMcpBridgeEvent('tool-response', {
            tool,
            ok: false,
            statusCode: 400,
            durationMs: Date.now() - startedAt,
            error: `Unknown OMC MCP tool: ${tool}`
          })
          return
        }
        logMcpBridgeEvent('tool-response', {
          tool,
          ok: result.ok,
          statusCode: result.ok ? 200 : 400,
          durationMs: Date.now() - startedAt,
          data: result.ok ? result.data : undefined,
          error: result.ok ? undefined : result.error
        })
        sendJson(response, result.ok ? 200 : 400, result)
      } catch (error) {
        logMcpBridgeEvent('tool-error', {
          url: request.url,
          method: request.method,
          statusCode: 500,
          error: error instanceof Error ? error.message : String(error)
        })
        sendJson(response, 500, { ok: false, error: { message: error instanceof Error ? error.message : 'MCP bridge failed' } })
      }
    })
    const preferredPorts = [37645, 0]
    for (const port of preferredPorts) {
      try {
        await new Promise<void>((resolveListen, rejectListen) => {
          server.once('error', rejectListen)
          server.listen(port, '127.0.0.1', () => resolveListen())
        })
        const address = server.address()
        if (!address || typeof address === 'string') throw new Error('MCP bridge did not return a port')
        this.mcpServer = server
        this.mcpPort = address.port
        this.mcpStartedAt = new Date()
        logMcpBridgeEvent('started', {
          name: MCP_SERVER_NAME,
          bridgeUrl: `http://127.0.0.1:${address.port}`
        })
        return address.port
      } catch {
        server.removeAllListeners('error')
      }
    }
    throw new Error('Unable to start Open Mission Control MCP bridge')
  }

  private async writeMcpScript(): Promise<string> {
    const path = mcpScriptPath()
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, mcpServerScript(), 'utf8')
    return path
  }

  async getMcpSetup(payload: { actorToken?: string }): Promise<ServiceResponse<McpSetupInfo>> {
    const actor = await this.auth.requireActor(payload?.actorToken)
    const port = await this.ensureMcpBridge()
    const scriptPath = await this.writeMcpScript()
    const bridgeUrl = `http://127.0.0.1:${port}`
    const token = actor.session.token
    const codexBlock = codexTomlBlock(scriptPath, bridgeUrl, token)
    const claudeConfig = claudeDesktopServerConfig(scriptPath, bridgeUrl, token)
    return okResponse({
      bridgeUrl,
      lanUrls: localIpv4Addresses().map((address) => `http://${address}:${port}`),
      scriptPath,
      codexConfigPath: codexConfigPath(),
      claudeDesktopConfigPath: claudeDesktopConfigPath(),
      commands: {
        codex: codexInstallCommand(codexConfigPath(), codexBlock),
        claudeDesktopRestart: process.platform === 'darwin'
          ? 'osascript -e \'quit app "Claude"\' && open -a Claude'
          : 'Restart Claude Desktop after the config is written.'
      },
      snippets: {
        codexToml: codexBlock,
        claudeDesktopJson: JSON.stringify({ mcpServers: { [MCP_SERVER_NAME]: claudeConfig } }, null, 2)
      }
    })
  }

  async getMcpStatus(payload: { actorToken?: string }): Promise<ServiceResponse<McpStatusInfo>> {
    const actor = await this.auth.requireActor(payload?.actorToken)
    const checkedAt = new Date().toISOString()
    try {
      const port = await this.ensureMcpBridge()
      const scriptPath = await this.writeMcpScript()
      const bridgeUrl = `http://127.0.0.1:${port}`
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 2_000)
      try {
        const response = await fetch(`${bridgeUrl}/health`, { signal: controller.signal })
        const data = await response.json().catch(() => undefined)
        const bridgeAvailable = response.ok && Boolean((data as { ok?: unknown } | undefined)?.ok)
        const stdioProbe = bridgeAvailable
          ? await probeMcpStdio(scriptPath, bridgeUrl, actor.session.token)
          : {
              ok: false,
              durationMs: 0,
              initializeOk: false,
              toolsListOk: false,
              error: `Bridge health endpoint returned ${response.status}`
            }
        const available = bridgeAvailable && stdioProbe.ok
        return okResponse({
          available,
          name: MCP_SERVER_NAME,
          bridgeUrl,
          checkedAt,
          startedAt: this.mcpStartedAt?.toISOString() ?? null,
          message: available
            ? 'MCP bridge and stdio handshake are running.'
            : bridgeAvailable
              ? 'MCP bridge is running, but MCP client handshake failed.'
              : 'MCP bridge health check failed.',
          bridgeAvailable,
          stdioProbe,
          ...(available ? {} : { error: stdioProbe.error ?? `Health endpoint returned ${response.status}` })
        })
      } finally {
        clearTimeout(timeout)
      }
    } catch (error) {
      return okResponse({
        available: false,
        name: MCP_SERVER_NAME,
        bridgeUrl: this.mcpPort ? `http://127.0.0.1:${this.mcpPort}` : null,
        checkedAt,
        startedAt: this.mcpStartedAt?.toISOString() ?? null,
        message: 'MCP bridge is not available.',
        bridgeAvailable: false,
        stdioProbe: {
          ok: false,
          durationMs: 0,
          initializeOk: false,
          toolsListOk: false,
          error: error instanceof Error ? error.message : String(error)
        },
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }

  async installMcpClient(payload: InstallMcpClientRequest): Promise<ServiceResponse<{ client: string; path: string; bridgeUrl: string }>> {
    const setup = await this.getMcpSetup({ actorToken: payload?.actorToken })
    if (!setup.ok || !setup.data) {
      return errorResponse(setup.error?.code ?? ErrorCodes.Internal, setup.error?.message ?? 'MCP setup could not be loaded', setup.error?.details)
    }
    const client = payload?.client
    if (client === 'codex') {
      await upsertCodexBlock(setup.data.codexConfigPath, setup.data.snippets.codexToml)
      return okResponse({ client, path: setup.data.codexConfigPath, bridgeUrl: setup.data.bridgeUrl })
    }
    if (client === 'claude_desktop') {
      await upsertClaudeDesktopConfig(setup.data.claudeDesktopConfigPath, claudeDesktopServerConfig(setup.data.scriptPath, setup.data.bridgeUrl, (await this.auth.requireActor(payload?.actorToken)).session.token))
      return okResponse({ client, path: setup.data.claudeDesktopConfigPath, bridgeUrl: setup.data.bridgeUrl })
    }
    return errorResponse(ErrorCodes.Validation, 'MCP client is invalid')
  }
}

export { ACTIVE_GATEWAY_KEY }
