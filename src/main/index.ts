import { bootstrapApp } from './bootstrap/app.js'
import { installEpipeGuards, safeConsole } from './utils/safe-output.js'

installEpipeGuards()

process.on('uncaughtException', (error) => {
  if ((error as { code?: unknown })?.code === 'EPIPE') {
    return
  }
  safeConsole.error('Uncaught exception', error)
  process.exitCode = 1
})

process.on('unhandledRejection', (reason) => {
  safeConsole.error('Unhandled rejection', reason)
  process.exitCode = 1
})

void bootstrapApp().catch((error) => {
  safeConsole.error('bootstrap error', error)
  process.exitCode = 1
})
