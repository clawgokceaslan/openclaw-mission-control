export interface OpenClawDocTerm {
  term: string
  description: string
}

export interface OpenClawDoc {
  id: string
  title: string
  category: string
  summary: string
  sourceFiles: string[]
  terms: OpenClawDocTerm[]
  markdown: string
}

export const OPENCLAW_DOCS: OpenClawDoc[] = [
  {
    id: 'gateway-websocket-protocol',
    title: 'Gateway WebSocket Protocol',
    category: 'Protocol',
    summary: 'Remote WS RPC contract used by Mission Control to talk to OpenClaw gateways.',
    sourceFiles: ['mc/backend/app/services/openclaw/gateway_rpc.py', 'mc/docs/openclaw_gateway_ws.md'],
    terms: [
      { term: 'WS URL', description: 'The remote OpenClaw websocket endpoint, usually ws://host:18789 or wss://host:18789.' },
      { term: 'RPC envelope', description: 'Every request is sent as { type: "req", id, method, params }.' },
      { term: 'Protocol version', description: 'OpenClaw gateway protocol currently negotiates version 3.' }
    ],
    markdown: `# Gateway WebSocket Protocol

OpenClaw gateway communication is websocket-first. Mission Control opens a remote websocket and sends JSON RPC-like request envelopes.

\`\`\`json
{ "type": "req", "id": "<uuid>", "method": "status", "params": {} }
\`\`\`

The gateway replies with the same \`id\`, allowing Mission Control to correlate the pending request.

## OpenMissionControl mapping

- The Node/Electron client lives in the gateway runtime layer.
- No Python subprocess is used.
- No local OpenClaw config is read.
- The gateway URL and token come from the Gateway record.

## Important methods

- \`connect\`: authenticate and negotiate protocol.
- \`status\`: verify gateway runtime status.
- \`sessions.patch\`: create or update a chat session.
- \`chat.send\`: send a user message into a session.
- \`chat.history\`: read session messages.

## Edge cases

- Invalid JSON frames are stored as unparsed gateway events.
- RPC timeout must reject only the matching request id.
- Transport disconnect should fail pending calls and update session state.`
  },
  {
    id: 'pairing-device-identity',
    title: 'Pairing and Device Identity',
    category: 'Auth',
    summary: 'How Mission Control identifies itself to a remote OpenClaw gateway without local OpenClaw files.',
    sourceFiles: ['mc/backend/app/services/openclaw/device_identity.py', 'src/main/services/gateway/rpc-client.ts'],
    terms: [
      { term: 'Device identity', description: 'Ed25519 keypair used to sign connect payloads.' },
      { term: 'Pairing', description: 'Approval flow where OpenClaw accepts a new device public key.' },
      { term: 'privateKeyPem', description: 'Secret key stored only in Gateway template and never returned to renderer.' }
    ],
    markdown: `# Pairing and Device Identity

The original OpenClaw service stores device identity under local OpenClaw paths. OpenMissionControl cannot rely on that because OpenClaw may run on another machine.

OpenMissionControl stores its own device identity in the local Gateway record:

\`\`\`ts
template.deviceIdentity = {
  deviceId,
  publicKeyPem,
  privateKeyPem,
  createdAt
}
\`\`\`

## Connect signature

The client signs a stable payload containing:

- device id
- client id
- client mode
- role
- scopes
- signed timestamp
- optional gateway token
- optional challenge nonce

## Security rule

\`privateKeyPem\` must never be exposed to renderer IPC responses. Renderer can see the device id and public key fingerprint only.

## User flow

1. User clicks \`Pair\`.
2. Mission Control generates or reuses a device identity.
3. Gateway replies with paired / pending / rejected.
4. User approves on OpenClaw side if required.
5. Connect and Test can proceed after pairing.`
  },
  {
    id: 'rpc-envelope',
    title: 'RPC Request/Response Envelope',
    category: 'Protocol',
    summary: 'The request shape, response correlation, and failure model used for OpenClaw RPC.',
    sourceFiles: ['mc/backend/app/services/openclaw/gateway_rpc.py', 'src/main/services/gateway/rpc-client.ts'],
    terms: [
      { term: 'id', description: 'Unique request id used to resolve the matching pending promise.' },
      { term: 'method', description: 'Gateway method name, for example status or chat.send.' },
      { term: 'params', description: 'Method-specific input object.' }
    ],
    markdown: `# RPC Envelope

OpenClaw gateway calls use a simple request envelope:

\`\`\`json
{
  "type": "req",
  "id": "2e86...",
  "method": "chat.send",
  "params": { "sessionKey": "...", "message": "How are you?", "deliver": true }
}
\`\`\`

Responses are resolved by \`id\`. Gateway errors are normalized into user-visible messages.

## Implementation notes

- Keep one pending map per websocket client.
- Clear timeout when a response arrives.
- Reject only the request that timed out.
- Store outgoing RPC event metadata in gateway history for debugging.

## Common failure cases

- Unknown method.
- Auth rejected.
- Pairing required.
- Transport closed before response.
- Response did not include the pending id.`
  },
  {
    id: 'connect-handshake',
    title: 'Connect Handshake',
    category: 'Connection',
    summary: 'OpenClaw connect sequence including challenge handling and device pairing mode.',
    sourceFiles: ['mc/backend/app/services/openclaw/gateway_rpc.py', 'src/main/services/gateway/rpc-client.ts'],
    terms: [
      { term: 'connect.challenge', description: 'Optional first event sent by gateway with a nonce.' },
      { term: 'operator scopes', description: 'Permissions requested by Mission Control: read, admin, approvals, pairing.' },
      { term: 'control UI token mode', description: 'Advanced fallback that authenticates with a UI token instead of device pairing.' }
    ],
    markdown: `# Connect Handshake

Mission Control waits briefly for \`connect.challenge\`. If a nonce is received, it is included in the signed device payload. The nonce is not sent as a root property.

\`\`\`json
{
  "minProtocol": 3,
  "maxProtocol": 3,
  "role": "operator",
  "scopes": ["operator.read", "operator.admin", "operator.approvals", "operator.pairing"],
  "client": { "id": "gateway-client", "mode": "backend" },
  "device": { "id": "...", "publicKey": "...", "signature": "...", "signedAt": 177... }
}
\`\`\`

## OpenMissionControl behavior

- \`Connect\` performs handshake/status only.
- \`Test\` sends a chat message after connect succeeds.
- Pairing pending is not treated as online.

## Remote-safe rule

Mission Control never reads OpenClaw local config or identity files. Everything needed for connect comes from the Gateway record.`
  },
  {
    id: 'chat-send-history',
    title: 'Chat Send and History',
    category: 'Chat',
    summary: 'How TEST sends a message and waits for an assistant response.',
    sourceFiles: ['mc/backend/app/services/openclaw/session_service.py', 'mc/backend/app/services/openclaw/gateway_rpc.py', 'src/main/services/gateway/response-parser.ts'],
    terms: [
      { term: 'chat.send', description: 'RPC method that sends a user message into a session.' },
      { term: 'chat.history', description: 'RPC method that returns session messages.' },
      { term: 'deliver', description: 'When true, the gateway should deliver the message to the agent runtime.' },
      { term: 'NO_REPLY', description: 'Valid assistant final text that means the agent intentionally chose no user-facing reply.' }
    ],
    markdown: `# Chat Send and History

The gateway TEST flow is intentionally chat-like:

1. Ensure a test session exists.
2. Send the fixed message \`How are you?\`.
3. Poll \`chat.history\`.
4. Extract the newest assistant message.
5. Render only the final text in the UI.

## Response parser

OpenClaw messages may include thinking blocks and final text blocks:

\`\`\`json
{
  "role": "assistant",
  "content": [
    { "type": "thinking", "thinking": "..." },
    { "type": "text", "text": "Yep, I am online." }
  ]
}
\`\`\`

The adapter ignores \`thinking\` and returns only \`type: "text"\` content. Raw JSON remains available under the expandable response panel.

## Important detail

\`NO_REPLY\` is still a real assistant response. It should be shown as plain text, not treated as an error.`
  },
  {
    id: 'session-keys-lifecycle',
    title: 'Session Keys and Session Lifecycle',
    category: 'Sessions',
    summary: 'How OpenClaw sessions are named, patched, reused, and read.',
    sourceFiles: ['mc/backend/app/services/openclaw/internal/session_keys.py', 'mc/backend/app/services/openclaw/session_service.py', 'mc/backend/app/services/openclaw/gateway_dispatch.py'],
    terms: [
      { term: 'sessionKey', description: 'Stable logical key used to address a gateway chat session.' },
      { term: 'sessions.patch', description: 'Creates or updates a session label and metadata.' },
      { term: 'idempotencyKey', description: 'Prevents duplicate chat.send side effects when retried.' }
    ],
    markdown: `# Session Keys and Lifecycle

OpenClaw sessions are addressed by stable keys instead of local database ids. OpenMissionControl uses:

\`\`\`txt
openmissioncontrol:<gatewayId>:test
\`\`\`

for gateway TEST messages.

## Lifecycle

- \`sessions.patch\` ensures the session exists.
- \`chat.send\` writes a user message.
- \`chat.history\` returns the conversation.
- \`sessions.delete\` may be used for cleanup tooling, but is not part of the normal TEST flow.

## Implementation guidance

Use stable keys for deterministic UI behavior. Use idempotency keys for message sending. Do not store OpenClaw's remote session as the source of local auth state.`
  },
  {
    id: 'gateway-resolver-db-boundary',
    title: 'Gateway Resolver and DB Boundary',
    category: 'Architecture',
    summary: 'Where database-backed gateway records become RPC client configuration.',
    sourceFiles: ['mc/backend/app/services/openclaw/gateway_resolver.py', 'mc/backend/app/services/openclaw/db_service.py'],
    terms: [
      { term: 'Gateway record', description: 'Local row containing URL, token, TLS settings, pairing state, and device identity.' },
      { term: 'DB-free RPC client', description: 'Low-level client that only knows URL/token/template, not repositories.' },
      { term: 'tenant guard', description: 'Check that the gateway belongs to the same organization as the actor.' }
    ],
    markdown: `# Gateway Resolver and DB Boundary

The mc code separates database resolution from raw gateway RPC calls. OpenMissionControl follows the same direction:

- Service layer checks actor/org ownership.
- Repository loads the Gateway record.
- Runtime client receives a plain Gateway config.
- RPC client does not query the database.

## Why this matters

This keeps the transport layer reusable and easier to reason about. Pairing, masking, and tenant checks stay in service/repository code rather than websocket code.

## Remote-safe change

The original mc resolver includes workspace helpers. For OpenMissionControl remote gateway support, workspace root is legacy metadata and not required for connect/test.`
  },
  {
    id: 'dispatch-flow',
    title: 'Dispatch Flow',
    category: 'Architecture',
    summary: 'How higher-level services send messages through gateway RPC without owning transport details.',
    sourceFiles: ['mc/backend/app/services/openclaw/gateway_dispatch.py', 'mc/backend/app/services/openclaw/session_service.py'],
    terms: [
      { term: 'dispatch service', description: 'A service that resolves config and sends agent messages through the gateway.' },
      { term: 'deliver false', description: 'Records or prepares a message without necessarily waking the agent runtime.' },
      { term: 'deliver true', description: 'Actually asks OpenClaw to deliver the message to the agent.' }
    ],
    markdown: `# Dispatch Flow

The dispatch layer bridges app intent and gateway transport. It resolves a gateway config, ensures a session, and sends a message.

## OpenMissionControl mapping

Gateway TEST uses the same conceptual flow:

1. Resolve Gateway by id.
2. Ensure pairing identity.
3. Connect to remote OpenClaw.
4. Patch a session.
5. Send message with \`deliver: true\`.
6. Poll history for assistant response.

## Important rule

The dispatch layer should not decide how to render assistant content. Rendering-friendly parsing belongs in the OpenClaw response adapter.`
  },
  {
    id: 'error-normalization',
    title: 'Error Normalization',
    category: 'Errors',
    summary: 'How gateway, auth, pairing, and transport failures should be shown to users.',
    sourceFiles: ['mc/backend/app/services/openclaw/error_messages.py', 'mc/backend/app/services/openclaw/exceptions.py', 'src/main/services/gateway/gateway.service.ts'],
    terms: [
      { term: 'pairing pending', description: 'Gateway rejected connect until the device is approved.' },
      { term: 'origin not allowed', description: 'Control UI token mode origin problem; device pairing is the safer remote default.' },
      { term: 'transport error', description: 'Network/websocket failure before a valid OpenClaw response.' }
    ],
    markdown: `# Error Normalization

OpenClaw errors arrive from multiple layers:

- websocket transport
- connect/auth handshake
- pairing approval
- RPC method failure
- chat timeout

## OpenMissionControl behavior

- Pairing-related failures update \`pairingStatus\`.
- Timeout during TEST means connect worked but no assistant response arrived in time.
- Raw gateway payloads are preserved in history/details for debugging.
- User-facing text should be direct and not expose private keys or raw tokens.

## Common fixes

- Pairing pending: approve the device in OpenClaw and retry.
- Wrong token: replace gateway token.
- Origin not allowed: prefer device pairing instead of control UI token mode.
- Self-signed TLS: enable the TLS toggle only for trusted endpoints.`
  },
  {
    id: 'compatibility-checks',
    title: 'Compatibility Checks',
    category: 'Compatibility',
    summary: 'Version checks and protocol compatibility extracted from mc gateway compatibility logic.',
    sourceFiles: ['mc/backend/app/services/openclaw/gateway_compat.py', 'mc/backend/tests/test_gateway_version_compat.py'],
    terms: [
      { term: 'server.version', description: 'Gateway-reported version from connect metadata.' },
      { term: 'config meta', description: 'Fallback version metadata found in config payloads.' },
      { term: 'minimum version', description: 'Required gateway runtime version for reliable protocol support.' }
    ],
    markdown: `# Compatibility Checks

mc validates gateway runtime versions using connect metadata and config metadata fallbacks.

## Why it matters

Gateway protocol methods evolve. A UI can connect to an older gateway but still fail later on missing methods.

## OpenMissionControl mapping

Current implementation records \`protocolVersion: "3"\` after a successful handshake. Future work can add a compatibility card that calls \`config.get\` or inspects connect metadata.

## Developer note

Keep compatibility checks advisory unless a missing method would corrupt data. For gateway TEST, a missing \`chat.send\` or \`chat.history\` should fail clearly.`
  },
  {
    id: 'config-baseline-terms',
    title: 'Config and Baseline Terms',
    category: 'Config',
    summary: 'Important OpenClaw configuration terms that appear in mc docs and gateway behavior.',
    sourceFiles: ['mc/docs/openclaw_baseline_config.md', 'mc/backend/app/services/openclaw/provisioning.py', 'mc/backend/app/services/openclaw/provisioning_db.py'],
    terms: [
      { term: 'thinkingDefault', description: 'Default reasoning level for OpenClaw agent responses.' },
      { term: 'NO_REPLY', description: 'Configured final response when nothing should be said.' },
      { term: 'memoryFlush', description: 'Compaction-time memory write behavior.' },
      { term: 'workspace', description: 'OpenClaw local workspace path; remote Mission Control should not depend on it.' }
    ],
    markdown: `# Config and Baseline Terms

OpenClaw baseline config controls agent behavior, model settings, memory, compaction, and gateway defaults.

## Terms to know

- \`thinkingDefault\`: default reasoning level.
- \`NO_REPLY\`: valid final answer when the agent intentionally does not need to reply.
- \`memoryFlush\`: instruction for saving durable notes during compaction.
- \`workspace\`: local OpenClaw file workspace.

## Remote-safe note

OpenMissionControl should not require the OpenClaw workspace path because OpenClaw may be running on a different machine. Workspace remains a legacy/config term, not a connection dependency.`
  },
  {
    id: 'openmissioncontrol-adapter-mapping',
    title: 'OpenMissionControl Adapter Mapping',
    category: 'Adapter',
    summary: 'How mc concepts map into this Electron/Node gateway implementation.',
    sourceFiles: ['src/main/services/gateway/rpc-client.ts', 'src/main/services/gateway/response-parser.ts', 'src/main/services/gateway/gateway.service.ts'],
    terms: [
      { term: 'runtime registry', description: 'Map of active gateway clients keyed by gateway id.' },
      { term: 'chat response adapter', description: 'Parser that extracts final text from OpenClaw assistant messages.' },
      { term: 'masked template', description: 'Renderer-safe gateway template with private key removed.' }
    ],
    markdown: `# OpenMissionControl Adapter Mapping

OpenMissionControl ports the gateway behavior into Electron main / Node:

- \`OpenClawGatewayClient\`: websocket RPC client.
- \`OpenClawGatewayRuntimeRegistry\`: active connection registry.
- \`GatewayService\`: auth, org guard, pairing persistence, status/history updates.
- \`OpenClawResponseParser\`: converts OpenClaw content arrays into UI-safe final text.

## Important differences from mc

- No Python.
- No local OpenClaw config read.
- Device identity is stored in the local gateway record.
- Workspace root is not required.
- Renderer receives masked token/private key data only.

## Developer checklist

- Keep protocol details in the gateway client.
- Keep persistence and masking in the service/repository layer.
- Keep markdown/docs static for packaged app safety.
- Keep UI display parsing separate from transport parsing.`
  },
  {
    id: 'glossary',
    title: 'Glossary',
    category: 'Glossary',
    summary: 'Quick definitions for OpenClaw gateway terms used across the codebase.',
    sourceFiles: ['mc/backend/app/services/openclaw/*', 'src/main/services/gateway/*'],
    terms: [
      { term: 'gateway', description: 'Remote OpenClaw websocket service that exposes RPC methods.' },
      { term: 'device identity', description: 'Mission Control keypair used for device pairing auth.' },
      { term: 'pairing', description: 'Approval process for a device identity.' },
      { term: 'control UI token', description: 'Advanced auth mode using a UI token and origin restrictions.' },
      { term: 'connect.challenge', description: 'Optional nonce event before connect RPC.' },
      { term: 'sessionKey', description: 'Stable logical chat session key.' },
      { term: 'chat.send', description: 'Method that sends a message into a session.' },
      { term: 'chat.history', description: 'Method that reads session messages.' },
      { term: 'deliver', description: 'Boolean that controls whether a message is delivered to the agent runtime.' },
      { term: 'idempotencyKey', description: 'Unique key to prevent duplicate message side effects.' },
      { term: 'operator scopes', description: 'Permission strings requested by Mission Control.' },
      { term: 'workspaceRoot', description: 'Legacy local OpenClaw path; not used for remote-safe connection.' }
    ],
    markdown: `# Glossary

This card lists the gateway terms used in the docs and code.

## Connection terms

- **gateway**: Remote OpenClaw websocket service that exposes RPC methods.
- **WS URL**: Address used by Mission Control to connect.
- **Protocol v3**: Current connect protocol version.

## Auth terms

- **device identity**: Ed25519 keypair owned by Mission Control.
- **pairing**: OpenClaw-side approval of the device public key.
- **control UI token**: Advanced fallback auth mode with origin constraints.

## Chat terms

- **sessionKey**: Stable logical session key.
- **chat.send**: Send user text into the session.
- **chat.history**: Read messages from the session.
- **deliver**: Whether the gateway should deliver the message to the runtime.
- **idempotencyKey**: Duplicate-send protection.

## Legacy terms

- **workspaceRoot**: Local OpenClaw workspace path. Remote OpenMissionControl does not depend on it.`
  }
]

export const OPENCLAW_DOC_CATEGORIES = Array.from(new Set(OPENCLAW_DOCS.map((doc) => doc.category)))
