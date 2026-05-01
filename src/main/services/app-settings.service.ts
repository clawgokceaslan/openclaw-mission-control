import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
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
import { createRequire } from 'node:module';

const bridgeUrl = process.env.OMC_MCP_BRIDGE_URL;
const bridgeToken = process.env.OMC_MCP_TOKEN;
const moduleRoot = process.env.OMC_MCP_MODULE_ROOT;

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

async function sdkToolResult(toolName, args) {
  try {
    const data = await callBridge(toolName, args);
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
  } catch (error) {
    return {
      isError: true,
      content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }]
    };
  }
}

async function maybeStartSdkServer() {
  if (!moduleRoot) return false;
  try {
    const require = createRequire(moduleRoot.endsWith('package.json') ? moduleRoot : moduleRoot + '/package.json');
    const { McpServer } = await import(require.resolve('@modelcontextprotocol/sdk/server/mcp.js'));
    const { StdioServerTransport } = await import(require.resolve('@modelcontextprotocol/sdk/server/stdio.js'));
    const { z } = await import(require.resolve('zod'));
    const server = new McpServer({ name: 'openmissioncontrol', version: '0.1.0' });
    server.tool('omc_get_task_context', 'Read one Open Mission Control project and task planning context.', { projectId: z.string(), taskId: z.string() }, (args) => sdkToolResult('omc_get_task_context', args));
    server.tool('omc_validate_task_json', 'Validate and normalize one task JSON object without writing.', { projectId: z.string().optional(), taskId: z.string().optional(), json: z.unknown() }, (args) => sdkToolResult('omc_validate_task_json', args));
    server.tool('omc_create_task_from_json', 'Create a task in an Open Mission Control project from one task JSON object.', { projectId: z.string(), json: z.unknown() }, (args) => sdkToolResult('omc_create_task_from_json', args));
    server.tool('omc_update_task_from_json', 'Update an existing Open Mission Control task from one task JSON object.', { taskId: z.string(), json: z.unknown() }, (args) => sdkToolResult('omc_update_task_from_json', args));
    server.tool('omc_mark_task_ready_for_review', 'Mark one completed Codex task and all subtasks ready for review, then close its Codex terminal session.', { projectId: z.string().optional(), taskId: z.string() }, (args) => sdkToolResult('omc_mark_task_ready_for_review', args));
    await server.connect(new StdioServerTransport());
    console.error('Open Mission Control MCP server ready via SDK.');
    return true;
  } catch (error) {
    console.error('Open Mission Control MCP SDK unavailable; using compatibility transport.');
    return false;
  }
}

async function handle(message) {
  if (message.method === 'initialize') {
    writeMessage({
      jsonrpc: '2.0',
      id: message.id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'openmissioncontrol', version: '0.1.0' }
      }
    });
    return;
  }
  if (message.method === 'notifications/initialized') return;
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

if (!(await maybeStartSdkServer())) {
  process.stdin.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    pump();
  });
  console.error('Open Mission Control MCP server ready.');
}
`
}

async function replaceCodexBlock(path: string, block: string): Promise<void> {
  let current = ''
  try {
    current = await readFile(path, 'utf8')
  } catch {}
  const pattern = new RegExp(`\\n?\\[mcp_servers\\.${MCP_SERVER_NAME}\\][\\s\\S]*?(?=\\n\\[(?!mcp_servers\\.${MCP_SERVER_NAME}(?:\\.env)?\\])|$)`, 'm')
  const next = pattern.test(current)
    ? current.replace(pattern, `\n${block}\n`)
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
      try {
        if (request.method !== 'GET' && request.method !== 'POST') {
          sendJson(response, 405, { ok: false, error: { message: 'Method not allowed' } })
          return
        }
        if (request.method === 'GET' && request.url === '/health') {
          sendJson(response, 200, { ok: true, data: { name: MCP_SERVER_NAME } })
          return
        }
        if (request.method !== 'POST' || request.url !== '/tool') {
          sendJson(response, 404, { ok: false, error: { message: 'Not found' } })
          return
        }
        const authHeader = request.headers.authorization ?? ''
        const token = typeof authHeader === 'string' && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
        if (!token || !(await this.auth.getSessionActor(token))) {
          sendJson(response, 401, { ok: false, error: { message: 'Unauthorized' } })
          return
        }
        const body = await readRequestBody(request)
        const tool = typeof body.tool === 'string' ? body.tool : ''
        const args = body.arguments && typeof body.arguments === 'object' && !Array.isArray(body.arguments)
          ? body.arguments as Record<string, unknown>
          : {}
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
          return
        }
        sendJson(response, result.ok ? 200 : 400, result)
      } catch (error) {
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
        codex: `mkdir -p ${shellQuote(dirname(codexConfigPath()))} && cat >> ${shellQuote(codexConfigPath())} <<'TOML'\n${codexBlock}\nTOML`,
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

  async installMcpClient(payload: InstallMcpClientRequest): Promise<ServiceResponse<{ client: string; path: string; bridgeUrl: string }>> {
    const setup = await this.getMcpSetup({ actorToken: payload?.actorToken })
    if (!setup.ok || !setup.data) {
      return errorResponse(setup.error?.code ?? ErrorCodes.Internal, setup.error?.message ?? 'MCP setup could not be loaded', setup.error?.details)
    }
    const client = payload?.client
    if (client === 'codex') {
      await replaceCodexBlock(setup.data.codexConfigPath, setup.data.snippets.codexToml)
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
