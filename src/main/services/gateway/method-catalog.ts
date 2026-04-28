export type OpenClawMethodAccess = 'read' | 'write' | 'admin'

export interface OpenClawMethodDefinition {
  method: string
  group: string
  access: OpenClawMethodAccess
  description: string
  sampleParams?: Record<string, unknown>
}

export const OPENCLAW_PROTOCOL_VERSION = 3
export const OPENCLAW_OPERATOR_SCOPES = ['operator.read', 'operator.admin', 'operator.approvals', 'operator.pairing'] as const
export const OPENCLAW_TEST_MESSAGE = 'How are you?'

export const OPENCLAW_METHODS: OpenClawMethodDefinition[] = [
  { method: 'health', group: 'Core', access: 'read', description: 'Returns lightweight gateway health.' },
  { method: 'status', group: 'Core', access: 'read', description: 'Returns runtime status, server version, and capability metadata.' },
  { method: 'logs.tail', group: 'Core', access: 'read', description: 'Reads recent gateway logs.', sampleParams: { lines: 100 } },
  { method: 'usage.status', group: 'Usage', access: 'read', description: 'Returns usage tracking status.' },
  { method: 'usage.cost', group: 'Usage', access: 'read', description: 'Returns cost/usage summary.' },
  { method: 'tts.status', group: 'TTS', access: 'read', description: 'Returns TTS subsystem status.' },
  { method: 'tts.providers', group: 'TTS', access: 'read', description: 'Lists configured TTS providers.' },
  { method: 'tts.enable', group: 'TTS', access: 'write', description: 'Enables TTS.' },
  { method: 'tts.disable', group: 'TTS', access: 'write', description: 'Disables TTS.' },
  { method: 'tts.convert', group: 'TTS', access: 'write', description: 'Converts text to speech.', sampleParams: { text: 'Hello' } },
  { method: 'tts.setProvider', group: 'TTS', access: 'write', description: 'Sets active TTS provider.', sampleParams: { provider: 'default' } },
  { method: 'config.get', group: 'Config', access: 'read', description: 'Reads gateway config.' },
  { method: 'config.schema', group: 'Config', access: 'read', description: 'Reads config schema.' },
  { method: 'config.set', group: 'Config', access: 'admin', description: 'Replaces a config key/value.', sampleParams: { key: 'path.to.key', value: true } },
  { method: 'config.patch', group: 'Config', access: 'admin', description: 'Patches gateway config.', sampleParams: { patch: {} } },
  { method: 'config.apply', group: 'Config', access: 'admin', description: 'Applies pending config changes.' },
  { method: 'models.list', group: 'Models', access: 'read', description: 'Lists available models/providers.' },
  { method: 'sessions.list', group: 'Sessions', access: 'read', description: 'Lists chat sessions.' },
  { method: 'sessions.preview', group: 'Sessions', access: 'read', description: 'Returns a session preview.', sampleParams: { sessionKey: 'openmissioncontrol:<gatewayId>:test' } },
  { method: 'sessions.patch', group: 'Sessions', access: 'write', description: 'Creates or updates a session.', sampleParams: { key: 'openmissioncontrol:<gatewayId>:test', label: 'OpenMissionControl Gateway Test' } },
  { method: 'sessions.reset', group: 'Sessions', access: 'write', description: 'Resets a session.', sampleParams: { sessionKey: 'openmissioncontrol:<gatewayId>:test' } },
  { method: 'sessions.delete', group: 'Sessions', access: 'write', description: 'Deletes a session.', sampleParams: { sessionKey: 'openmissioncontrol:<gatewayId>:test' } },
  { method: 'sessions.compact', group: 'Sessions', access: 'write', description: 'Compacts session history.', sampleParams: { sessionKey: 'openmissioncontrol:<gatewayId>:test' } },
  { method: 'chat.send', group: 'Chat', access: 'write', description: 'Sends a chat message.', sampleParams: { sessionKey: 'openmissioncontrol:<gatewayId>:test', message: 'How are you?', deliver: true } },
  { method: 'chat.history', group: 'Chat', access: 'read', description: 'Reads chat history.', sampleParams: { sessionKey: 'openmissioncontrol:<gatewayId>:test', limit: 50 } },
  { method: 'chat.abort', group: 'Chat', access: 'write', description: 'Aborts active chat generation.', sampleParams: { sessionKey: 'openmissioncontrol:<gatewayId>:test' } },
  { method: 'node.pair.request', group: 'Pairing', access: 'admin', description: 'Requests node pairing.' },
  { method: 'node.pair.list', group: 'Pairing', access: 'read', description: 'Lists node pairing requests.' },
  { method: 'node.pair.approve', group: 'Pairing', access: 'admin', description: 'Approves node pairing.', sampleParams: { id: '<requestId>' } },
  { method: 'node.pair.reject', group: 'Pairing', access: 'admin', description: 'Rejects node pairing.', sampleParams: { id: '<requestId>' } },
  { method: 'node.pair.verify', group: 'Pairing', access: 'read', description: 'Verifies node pairing.' },
  { method: 'device.pair.list', group: 'Pairing', access: 'read', description: 'Lists device pairing requests.' },
  { method: 'device.pair.approve', group: 'Pairing', access: 'admin', description: 'Approves device pairing.', sampleParams: { deviceId: '<deviceId>' } },
  { method: 'device.pair.reject', group: 'Pairing', access: 'admin', description: 'Rejects device pairing.', sampleParams: { deviceId: '<deviceId>' } },
  { method: 'exec.approvals.get', group: 'Approvals', access: 'read', description: 'Reads execution approval policy.' },
  { method: 'exec.approvals.set', group: 'Approvals', access: 'admin', description: 'Updates execution approval policy.' },
  { method: 'exec.approvals.node.get', group: 'Approvals', access: 'read', description: 'Reads node approval policy.' },
  { method: 'exec.approvals.node.set', group: 'Approvals', access: 'admin', description: 'Updates node approval policy.' },
  { method: 'exec.approval.request', group: 'Approvals', access: 'write', description: 'Creates approval request.' },
  { method: 'exec.approval.resolve', group: 'Approvals', access: 'admin', description: 'Resolves approval request.' },
  { method: 'wizard.start', group: 'Wizard', access: 'write', description: 'Starts OpenClaw wizard.' },
  { method: 'wizard.next', group: 'Wizard', access: 'write', description: 'Advances OpenClaw wizard.' },
  { method: 'wizard.cancel', group: 'Wizard', access: 'write', description: 'Cancels OpenClaw wizard.' },
  { method: 'wizard.status', group: 'Wizard', access: 'read', description: 'Reads OpenClaw wizard status.' },
  { method: 'talk.mode', group: 'Channels', access: 'write', description: 'Reads or updates talk mode.' },
  { method: 'channels.status', group: 'Channels', access: 'read', description: 'Reads channel status.' },
  { method: 'channels.logout', group: 'Channels', access: 'admin', description: 'Logs out a channel.' }
]

export function isKnownOpenClawMethod(method: string): boolean {
  return OPENCLAW_METHODS.some((item) => item.method === method)
}

export function openClawMethod(method: string): OpenClawMethodDefinition | undefined {
  return OPENCLAW_METHODS.find((item) => item.method === method)
}
