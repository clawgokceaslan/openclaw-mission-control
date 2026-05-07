import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const sourceIcon = join(rootDir, 'app-icon.png')
const iconRoot = join(rootDir, 'build', 'icons')
const iconsetDir = join(iconRoot, 'AppIcon.iconset')
const icnsPath = join(iconRoot, 'app-icon.icns')

if (!existsSync(sourceIcon)) {
  throw new Error(`Source icon not found: ${sourceIcon}`)
}

rmSync(iconsetDir, { recursive: true, force: true })
mkdirSync(iconsetDir, { recursive: true })

const iconSizes = [
  ['icon_16x16.png', 16],
  ['icon_16x16@2x.png', 32],
  ['icon_32x32.png', 32],
  ['icon_32x32@2x.png', 64],
  ['icon_128x128.png', 128],
  ['icon_128x128@2x.png', 256],
  ['icon_256x256.png', 256],
  ['icon_256x256@2x.png', 512],
  ['icon_512x512.png', 512],
  ['icon_512x512@2x.png', 1024]
]

for (const [fileName, size] of iconSizes) {
  execFileSync('sips', [
    '-z',
    String(size),
    String(size),
    sourceIcon,
    '--out',
    join(iconsetDir, fileName)
  ], { stdio: 'ignore' })
}

rmSync(icnsPath, { force: true })
execFileSync('iconutil', ['-c', 'icns', iconsetDir, '-o', icnsPath], { stdio: 'inherit' })

console.log(`Generated macOS icon: ${icnsPath}`)
