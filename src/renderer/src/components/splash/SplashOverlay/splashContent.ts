export interface SplashMotivation {
  eyebrow: string
  title: string
  body: string
}

export interface SplashConfig {
  appTitle: string
  iconAlt: string
  spinnerLabel: string
  minimumDurationMs: number
  exitDurationMs: number
}

const isDevRuntime = import.meta.env.DEV

export const splashConfig: SplashConfig = {
  appTitle: 'Open Mission Control',
  iconAlt: 'Open Mission Control logo',
  spinnerLabel: 'Mission runtime hazirlaniyor',
  minimumDurationMs: isDevRuntime ? 2800 : 1800,
  exitDurationMs: 520
}

export const splashMotivations: SplashMotivation[] = [
  {
    eyebrow: 'Launch sequence',
    title: 'Bugunun gorevlerini netlestir, sinyali kacirma.',
    body: 'Projeler, agentlar ve task akislarin ayni kontrol panelinde hizaya geliyor.'
  },
  {
    eyebrow: 'Operator focus',
    title: 'Kucuk kararlar buyuk teslimatlari sessizce hizlandirir.',
    body: 'Open Mission Control calisma alanini, talimatlari ve aktif gorevleri senin icin toparliyor.'
  },
  {
    eyebrow: 'Runtime check',
    title: 'Her iyi operasyon once durumu dogru okumakla baslar.',
    body: 'Workspace, gateway ve plan sinyalleri acilis icin kontrol ediliyor.'
  },
  {
    eyebrow: 'Mission cadence',
    title: 'Tasklari parcala, baglami koru, ciktiyi tamamla.',
    body: 'Kod, plan ve inceleme akislarinin temiz bir rotaya oturmasi bekleniyor.'
  },
  {
    eyebrow: 'Control loop',
    title: 'Net talimat, temiz diff, guvenilir teslim.',
    body: 'Agent hafizasi ve proje kurallari acilis sirasi boyunca senkronize ediliyor.'
  },
  {
    eyebrow: 'System online',
    title: 'Odaklanmis bir panel, daginik bir sprintten daha gucludur.',
    body: 'Bugunun gorevleri icin navigasyon, bildirimler ve calisma durumu hazirlaniyor.'
  }
]

let bootMotivationIndex: number | null = null

export function getBootMotivation(): SplashMotivation {
  if (bootMotivationIndex === null) {
    const entropy = Date.now() + Math.floor(Math.random() * 1000)
    bootMotivationIndex = entropy % splashMotivations.length
  }

  return splashMotivations[bootMotivationIndex]
}

