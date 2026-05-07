import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import JavaScriptObfuscator from 'javascript-obfuscator'

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const targetRoots = [
  join(rootDir, 'dist', 'main'),
  join(rootDir, 'dist', 'renderer', 'assets')
]

function listJavaScriptFiles(directory) {
  if (!existsSync(directory)) return []

  const files = []
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry)
    const stat = statSync(path)
    if (stat.isDirectory()) {
      files.push(...listJavaScriptFiles(path))
    } else if (stat.isFile() && path.endsWith('.js')) {
      files.push(path)
    }
  }
  return files
}

function splitLeadingImports(source) {
  const importPattern = /(?:\s*import\s*[\s\S]*?from\s*['"][^'"]+['"];|\s*import\s*['"][^'"]+['"];)\s*/y
  const imports = []
  let cursor = 0

  while (cursor < source.length) {
    importPattern.lastIndex = cursor
    const match = importPattern.exec(source)
    if (!match) break
    imports.push(match[0].trim())
    cursor = importPattern.lastIndex
  }

  return {
    imports,
    body: source.slice(cursor)
  }
}

const files = targetRoots.flatMap(listJavaScriptFiles)
if (files.length === 0) {
  throw new Error('No built JavaScript files found to obfuscate. Run electron-vite build first.')
}

for (const file of files) {
  const source = readFileSync(file, 'utf8')
  const { imports, body } = splitLeadingImports(source)
  const isMainProcess = file.startsWith(join(rootDir, 'dist', 'main'))
  const result = JavaScriptObfuscator.obfuscate(body, {
    compact: true,
    controlFlowFlattening: false,
    deadCodeInjection: false,
    debugProtection: false,
    disableConsoleOutput: false,
    identifierNamesGenerator: 'hexadecimal',
    ignoreImports: true,
    inputFileName: file,
    numbersToExpressions: false,
    renameGlobals: false,
    selfDefending: false,
    simplify: true,
    sourceMap: false,
    splitStrings: false,
    stringArray: true,
    stringArrayCallsTransform: false,
    stringArrayEncoding: [],
    stringArrayIndexesType: ['hexadecimal-number'],
    stringArrayRotate: true,
    stringArrayShuffle: true,
    stringArrayThreshold: 0.5,
    target: isMainProcess ? 'node' : 'browser'
  })
  writeFileSync(file, `${imports.length > 0 ? `${imports.join('\n')}\n` : ''}${result.getObfuscatedCode()}`)
  console.log(`Obfuscated ${file}`)
}

console.log(`Obfuscated ${files.length} built JavaScript file${files.length === 1 ? '' : 's'}.`)
