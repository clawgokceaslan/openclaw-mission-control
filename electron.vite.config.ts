import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'

export default defineConfig({
  main: {
    build: {
      outDir: 'dist/main'
    }
  },
  renderer: {
    root: 'src/renderer',
    plugins: [react()],
    server: {
      host: '0.0.0.0',
      allowedHosts: true
    },
    preview: {
      host: '0.0.0.0',
      allowedHosts: true
    },
    resolve: {
      alias: {
        '@renderer': resolve(__dirname, 'src/renderer/src'),
        '@shared': resolve(__dirname, 'src/shared')
      }
    },
    build: {
      outDir: 'dist/renderer'
    }
  }
})
