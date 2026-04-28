type Emitter = {
  on: (event: string, listener: (...args: unknown[]) => void) => void
}

function isEpipeError(error: unknown): boolean {
  const candidate = error as { code?: unknown }
  return candidate?.code === 'EPIPE'
}

export function installEpipeGuards(): void {
  const streams: Array<Emitter | undefined> = [
    process.stdout as unknown as Emitter,
    process.stderr as unknown as Emitter
  ]

  for (const stream of streams) {
    if (!stream?.on) {
      continue
    }
    stream.on('error', (error) => {
      if (!isEpipeError(error)) {
        console.error('Stream write error', error)
      }
    })
  }
}

export const safeConsole = {
  log: (...args: unknown[]) => {
    try {
      console.log(...args)
    } catch (error) {
      if (!isEpipeError(error)) {
        throw error
      }
    }
  },
  info: (...args: unknown[]) => {
    try {
      console.info(...args)
    } catch (error) {
      if (!isEpipeError(error)) {
        throw error
      }
    }
  },
  warn: (...args: unknown[]) => {
    try {
      console.warn(...args)
    } catch (error) {
      if (!isEpipeError(error)) {
        throw error
      }
    }
  },
  error: (...args: unknown[]) => {
    try {
      console.error(...args)
    } catch (error) {
      if (!isEpipeError(error)) {
        throw error
      }
    }
  }
}
