import { createHash, createPublicKey, generateKeyPairSync, sign } from 'node:crypto'
import type { OpenClawGatewayDeviceIdentity } from '../../../shared/types/entities.js'

export function base64Url(raw: Buffer): string {
  return raw.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
}

export function publicKeyRaw(publicKeyPem: string): Buffer {
  const der = createPublicKey(publicKeyPem).export({ format: 'der', type: 'spki' }) as Buffer
  return der.subarray(der.length - 32)
}

export function deriveDeviceId(publicKeyPem: string): string {
  return createHash('sha256').update(publicKeyRaw(publicKeyPem)).digest('hex')
}

export function createOpenClawDeviceIdentity(): OpenClawGatewayDeviceIdentity {
  const pair = generateKeyPairSync('ed25519')
  const publicKeyPem = pair.publicKey.export({ format: 'pem', type: 'spki' }).toString()
  const privateKeyPem = pair.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString()
  return { deviceId: deriveDeviceId(publicKeyPem), publicKeyPem, privateKeyPem, createdAt: Date.now() }
}

export function signDevicePayload(privateKeyPem: string, payload: string): string {
  return base64Url(sign(null, Buffer.from(payload, 'utf8'), privateKeyPem))
}
