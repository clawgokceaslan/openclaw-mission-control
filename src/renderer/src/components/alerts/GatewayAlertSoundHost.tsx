import { useEffect } from 'react'
import { IPC_CHANNELS, type GatewayAlertSoundEvent } from '@shared/contracts/ipc'
import { DEFAULT_ALERT_SOUND_SETTINGS, normalizeAlertSoundSettings, type AlertSoundSettings } from '@shared/utils/alert-sound-settings'
import { useAuth } from '@renderer/providers/auth/auth-state'
import { alertSoundCategoryForGatewayKind, playAlertSound } from '@renderer/utils/alertSounds'
import { invokeBridge, subscribeToChannel, unsubscribeFromChannel } from '@renderer/utils/api'

let cachedSettings: AlertSoundSettings = DEFAULT_ALERT_SOUND_SETTINGS

async function loadAlertSoundSettings(token: string | null): Promise<AlertSoundSettings> {
  const response = await invokeBridge<{ settings: AlertSoundSettings }>(IPC_CHANNELS.appSettings.getAlertSoundSettings, { actorToken: token })
  if (response.ok && response.data?.settings) {
    cachedSettings = normalizeAlertSoundSettings(response.data.settings)
  }
  return cachedSettings
}

function parsePayload(args: unknown[]): GatewayAlertSoundEvent | null {
  const payload = (args[1] ?? args[0]) as Partial<GatewayAlertSoundEvent> | undefined
  if (!payload || (payload.mode !== 'plan' && payload.mode !== 'run')) return null
  if (payload.kind !== 'completed' && payload.kind !== 'failed' && payload.kind !== 'stopped') return null
  return {
    kind: payload.kind,
    mode: payload.mode
  }
}

export function GatewayAlertSoundHost() {
  const { token } = useAuth()

  useEffect(() => {
    const onGatewayAlertSound = (...args: unknown[]) => {
      const event = parsePayload(args)
      if (!event) return
      void loadAlertSoundSettings(token).then((settings) => {
        const category = alertSoundCategoryForGatewayKind(event.kind)
        return playAlertSound(settings.variants[category], settings.volume)
      })
    }
    subscribeToChannel(IPC_CHANNELS.events.gatewayAlertSound, onGatewayAlertSound)
    return () => unsubscribeFromChannel(IPC_CHANNELS.events.gatewayAlertSound, onGatewayAlertSound)
  }, [token])

  return null
}
