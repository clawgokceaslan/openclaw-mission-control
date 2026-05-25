import type { AlertSoundCategory, AlertSoundVariant } from '@shared/utils/alert-sound-settings'

type ToneStep = {
  frequency: number
  startsAt: number
  duration: number
  gain: number
}

const VARIANT_STEPS: Record<AlertSoundVariant, ToneStep[]> = {
  chime: [
    { frequency: 660, startsAt: 0, duration: 0.12, gain: 0.52 },
    { frequency: 880, startsAt: 0.11, duration: 0.16, gain: 0.42 }
  ],
  pulse: [
    { frequency: 220, startsAt: 0, duration: 0.11, gain: 0.7 },
    { frequency: 180, startsAt: 0.13, duration: 0.16, gain: 0.58 }
  ],
  soft: [
    { frequency: 392, startsAt: 0, duration: 0.18, gain: 0.34 },
    { frequency: 494, startsAt: 0.17, duration: 0.22, gain: 0.28 }
  ],
  bright: [
    { frequency: 784, startsAt: 0, duration: 0.1, gain: 0.5 },
    { frequency: 988, startsAt: 0.09, duration: 0.12, gain: 0.48 },
    { frequency: 1175, startsAt: 0.2, duration: 0.16, gain: 0.35 }
  ]
}

let audioContext: AudioContext | null = null

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null
  const AudioContextCtor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AudioContextCtor) return null
  if (!audioContext || audioContext.state === 'closed') audioContext = new AudioContextCtor()
  return audioContext
}

export function alertSoundCategoryForGatewayKind(kind: 'completed' | 'failed' | 'stopped'): AlertSoundCategory {
  if (kind === 'failed') return 'error'
  if (kind === 'stopped') return 'warning'
  return 'completed'
}

export async function playAlertSound(variant: AlertSoundVariant, volume: number): Promise<void> {
  const safeVolume = Math.min(1, Math.max(0, volume))
  if (safeVolume <= 0) return

  const context = getAudioContext()
  if (!context) return
  if (context.state === 'suspended') {
    await context.resume().catch(() => undefined)
  }
  const now = context.currentTime
  const master = context.createGain()
  master.gain.setValueAtTime(safeVolume, now)
  master.connect(context.destination)

  for (const step of VARIANT_STEPS[variant]) {
    const oscillator = context.createOscillator()
    const envelope = context.createGain()
    const start = now + step.startsAt
    const end = start + step.duration
    oscillator.type = variant === 'pulse' ? 'triangle' : 'sine'
    oscillator.frequency.setValueAtTime(step.frequency, start)
    envelope.gain.setValueAtTime(0.0001, start)
    envelope.gain.exponentialRampToValueAtTime(step.gain, start + 0.012)
    envelope.gain.exponentialRampToValueAtTime(0.0001, end)
    oscillator.connect(envelope)
    envelope.connect(master)
    oscillator.start(start)
    oscillator.stop(end + 0.02)
  }
}

