const { readdirSync } = require('node:fs')
const { join } = require('node:path')
const { execFileSync } = require('node:child_process')

module.exports = async function afterPackAdHocSign(context) {
  if (context.electronPlatformName !== 'darwin') return

  const appName = readdirSync(context.appOutDir).find((entry) => entry.endsWith('.app'))
  if (!appName) {
    throw new Error(`No .app bundle found in ${context.appOutDir}`)
  }

  const appPath = join(context.appOutDir, appName)
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'inherit' })
}
