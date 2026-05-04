import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { RootRendererErrorBoundary } from './utils/rendererResilience'
import 'bootstrap/dist/css/bootstrap.min.css'
import './App.module.scss'

const root = document.getElementById('root')
if (!root) throw new Error('Root not found')

createRoot(root).render(
  <RootRendererErrorBoundary>
    <StrictMode>
      <App />
    </StrictMode>
  </RootRendererErrorBoundary>
)
