import type { AlertSoundCategory, AlertSoundVariant } from '@shared/utils/alert-sound-settings'

type ToneStep = {
  frequency: number
  startsAt: number
  duration: number
  gain: number
}

const VARIANT_STEPS: Record<AlertSoundVariant, ToneStep[]> = {
  'success-chime': [
    { frequency: 660, startsAt: 0, duration: 0.12, gain: 0.52 },
    { frequency: 880, startsAt: 0.11, duration: 0.16, gain: 0.42 }
  ],
  'success-rise': [
    { frequency: 523, startsAt: 0, duration: 0.1, gain: 0.42 },
    { frequency: 659, startsAt: 0.08, duration: 0.12, gain: 0.42 },
    { frequency: 784, startsAt: 0.19, duration: 0.14, gain: 0.34 }
  ],
  'success-pop': [
    { frequency: 740, startsAt: 0, duration: 0.07, gain: 0.5 },
    { frequency: 988, startsAt: 0.07, duration: 0.09, gain: 0.32 }
  ],
  'success-spark': [
    { frequency: 880, startsAt: 0, duration: 0.08, gain: 0.42 },
    { frequency: 1175, startsAt: 0.05, duration: 0.1, gain: 0.36 },
    { frequency: 1320, startsAt: 0.13, duration: 0.1, gain: 0.24 }
  ],
  'success-bloom': [
    { frequency: 392, startsAt: 0, duration: 0.18, gain: 0.28 },
    { frequency: 523, startsAt: 0.12, duration: 0.22, gain: 0.3 },
    { frequency: 659, startsAt: 0.25, duration: 0.2, gain: 0.22 }
  ],
  'error-pulse': [
    { frequency: 220, startsAt: 0, duration: 0.11, gain: 0.7 },
    { frequency: 180, startsAt: 0.13, duration: 0.16, gain: 0.58 }
  ],
  'error-buzz': [
    { frequency: 185, startsAt: 0, duration: 0.08, gain: 0.62 },
    { frequency: 196, startsAt: 0.07, duration: 0.08, gain: 0.58 },
    { frequency: 174, startsAt: 0.14, duration: 0.11, gain: 0.52 }
  ],
  'error-drop': [
    { frequency: 330, startsAt: 0, duration: 0.12, gain: 0.54 },
    { frequency: 247, startsAt: 0.1, duration: 0.13, gain: 0.58 },
    { frequency: 165, startsAt: 0.22, duration: 0.18, gain: 0.44 }
  ],
  'error-alarm': [
    { frequency: 440, startsAt: 0, duration: 0.09, gain: 0.58 },
    { frequency: 220, startsAt: 0.11, duration: 0.09, gain: 0.64 },
    { frequency: 440, startsAt: 0.23, duration: 0.11, gain: 0.46 }
  ],
  'error-thud': [
    { frequency: 130, startsAt: 0, duration: 0.16, gain: 0.72 },
    { frequency: 98, startsAt: 0.12, duration: 0.22, gain: 0.5 }
  ],
  'warning-soft': [
    { frequency: 392, startsAt: 0, duration: 0.18, gain: 0.34 },
    { frequency: 494, startsAt: 0.17, duration: 0.22, gain: 0.28 }
  ],
  'warning-beacon': [
    { frequency: 440, startsAt: 0, duration: 0.12, gain: 0.4 },
    { frequency: 554, startsAt: 0.16, duration: 0.12, gain: 0.4 },
    { frequency: 440, startsAt: 0.32, duration: 0.14, gain: 0.3 }
  ],
  'warning-nudge': [
    { frequency: 523, startsAt: 0, duration: 0.08, gain: 0.38 },
    { frequency: 466, startsAt: 0.09, duration: 0.1, gain: 0.34 }
  ],
  'warning-tick': [
    { frequency: 784, startsAt: 0, duration: 0.05, gain: 0.32 },
    { frequency: 784, startsAt: 0.08, duration: 0.05, gain: 0.28 },
    { frequency: 659, startsAt: 0.18, duration: 0.08, gain: 0.26 }
  ],
  'warning-sweep': [
    { frequency: 330, startsAt: 0, duration: 0.14, gain: 0.34 },
    { frequency: 494, startsAt: 0.11, duration: 0.16, gain: 0.34 },
    { frequency: 622, startsAt: 0.24, duration: 0.16, gain: 0.26 }
  ],
  'completed-bright': [
    { frequency: 784, startsAt: 0, duration: 0.1, gain: 0.5 },
    { frequency: 988, startsAt: 0.09, duration: 0.12, gain: 0.48 },
    { frequency: 1175, startsAt: 0.2, duration: 0.16, gain: 0.35 }
  ],
  'completed-fanfare': [
    { frequency: 523, startsAt: 0, duration: 0.12, gain: 0.44 },
    { frequency: 659, startsAt: 0.11, duration: 0.12, gain: 0.44 },
    { frequency: 1047, startsAt: 0.22, duration: 0.22, gain: 0.36 }
  ],
  'completed-glow': [
    { frequency: 349, startsAt: 0, duration: 0.2, gain: 0.26 },
    { frequency: 440, startsAt: 0.14, duration: 0.22, gain: 0.28 },
    { frequency: 523, startsAt: 0.3, duration: 0.22, gain: 0.24 }
  ],
  'completed-cascade': [
    { frequency: 988, startsAt: 0, duration: 0.08, gain: 0.34 },
    { frequency: 784, startsAt: 0.08, duration: 0.08, gain: 0.34 },
    { frequency: 659, startsAt: 0.16, duration: 0.1, gain: 0.32 },
    { frequency: 523, startsAt: 0.26, duration: 0.16, gain: 0.28 }
  ],
  'completed-resolve': [
    { frequency: 587, startsAt: 0, duration: 0.12, gain: 0.36 },
    { frequency: 740, startsAt: 0.1, duration: 0.14, gain: 0.38 },
    { frequency: 880, startsAt: 0.23, duration: 0.18, gain: 0.3 }
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
    oscillator.type = variant.startsWith('error-') ? 'triangle' : 'sine'
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
