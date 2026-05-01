import { useEffect, useState } from 'react'
import { LuCheck, LuClipboard, LuPlugZap, LuRefreshCw, LuTerminal } from 'react-icons/lu'
import { IPC_CHANNELS } from '@shared/contracts/ipc'
import { invokeBridge } from '@renderer/utils/api'
import { useAuth } from '@renderer/providers/auth/auth-state'
import styles from './SettingsPage.module.scss'

type McpSetupInfo = {
  bridgeUrl: string
  lanUrls: string[]
  scriptPath: string
  codexConfigPath: string
  claudeDesktopConfigPath: string
  commands: {
    codex: string
    claudeDesktopRestart: string
  }
  snippets: {
    codexToml: string
    claudeDesktopJson: string
  }
}

type InstallClient = 'codex' | 'claude_desktop'

const clientLabels: Record<InstallClient, string> = {
  codex: 'Codex',
  claude_desktop: 'Claude Desktop'
}

export function SettingsPage() {
  const { token } = useAuth()
  const [setup, setSetup] = useState<McpSetupInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState<InstallClient | 'refresh' | null>(null)
  const [copied, setCopied] = useState<string | null>(null)

  const refresh = async () => {
    setBusy('refresh')
    const response = await invokeBridge<McpSetupInfo>(IPC_CHANNELS.appSettings.getMcpSetup, { actorToken: token })
    setBusy(null)
    if (!response.ok || !response.data) {
      setError(response.error?.message ?? 'MCP setup could not be loaded.')
      setSetup(null)
      return
    }
    setError(null)
    setSetup(response.data)
  }

  useEffect(() => {
    void refresh()
  }, [token])

  const install = async (client: InstallClient) => {
    setBusy(client)
    const response = await invokeBridge<{ path: string; bridgeUrl: string }>(IPC_CHANNELS.appSettings.installMcpClient, {
      actorToken: token,
      client
    })
    setBusy(null)
    if (!response.ok || !response.data) {
      setError(response.error?.message ?? `${clientLabels[client]} MCP setup failed.`)
      return
    }
    setError(null)
    setNotice(`${clientLabels[client]} configured at ${response.data.path}. Restart the client to load the Open Mission Control tools.`)
    await refresh()
  }

  const copy = async (key: string, value: string) => {
    await navigator.clipboard.writeText(value)
    setCopied(key)
    window.setTimeout(() => setCopied((current) => current === key ? null : current), 1600)
  }

  return (
    <section className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1>Settings</h1>
          <p>Install the Open Mission Control MCP tools for Codex and Claude.</p>
        </div>
        <button className={styles.secondaryButton} type="button" onClick={() => void refresh()} disabled={busy === 'refresh'}>
          <LuRefreshCw size={15} />
          Refresh
        </button>
      </header>

      {error ? <p className={styles.error}>{error}</p> : null}
      {notice ? <p className={styles.notice}>{notice}</p> : null}

      <section className={styles.panel}>
        <div className={styles.panelHeader}>
          <span className={styles.panelIcon}><LuPlugZap size={19} /></span>
          <div>
            <h2>MCP connection</h2>
            <p>External agents use this local bridge while Open Mission Control is running.</p>
          </div>
        </div>
        <div className={styles.infoGrid}>
          <span>
            <small>Local bridge</small>
            <strong>{setup?.bridgeUrl ?? 'Loading...'}</strong>
          </span>
          <span>
            <small>MCP server script</small>
            <strong>{setup?.scriptPath ?? 'Loading...'}</strong>
          </span>
          <span>
            <small>LAN addresses</small>
            <strong>{setup?.lanUrls.length ? setup.lanUrls.join(', ') : 'Loopback only'}</strong>
          </span>
        </div>
      </section>

      <div className={styles.clientGrid}>
        <section className={styles.panel}>
          <div className={styles.panelHeader}>
            <span className={styles.panelIcon}><LuTerminal size={19} /></span>
            <div>
              <h2>Codex</h2>
              <p>Writes the MCP server block into the Codex config file.</p>
            </div>
          </div>
          <button className={styles.primaryButton} type="button" onClick={() => void install('codex')} disabled={!setup || busy === 'codex'}>
            {busy === 'codex' ? 'Installing...' : 'Install for Codex'}
          </button>
          <CodeBlock
            title={setup?.codexConfigPath ?? '~/.codex/config.toml'}
            value={setup?.snippets.codexToml ?? ''}
            copied={copied === 'codex'}
            onCopy={() => setup && copy('codex', setup.snippets.codexToml)}
          />
        </section>

        <section className={styles.panel}>
          <div className={styles.panelHeader}>
            <span className={styles.panelIcon}><LuTerminal size={19} /></span>
            <div>
              <h2>Claude Desktop</h2>
              <p>Updates Claude Desktop MCP config. Restart Claude after installing.</p>
            </div>
          </div>
          <button className={styles.primaryButton} type="button" onClick={() => void install('claude_desktop')} disabled={!setup || busy === 'claude_desktop'}>
            {busy === 'claude_desktop' ? 'Installing...' : 'Install for Claude'}
          </button>
          <CodeBlock
            title={setup?.claudeDesktopConfigPath ?? 'claude_desktop_config.json'}
            value={setup?.snippets.claudeDesktopJson ?? ''}
            copied={copied === 'claude'}
            onCopy={() => setup && copy('claude', setup.snippets.claudeDesktopJson)}
          />
        </section>
      </div>

      <section className={styles.panel}>
        <div className={styles.panelHeader}>
          <span className={styles.panelIcon}><LuCheck size={19} /></span>
          <div>
            <h2>Available MCP tools</h2>
            <p>Use these from Codex or Claude with a project id and task id.</p>
          </div>
        </div>
        <div className={styles.toolList}>
          <code>omc_get_task_context</code>
          <code>omc_validate_task_json</code>
          <code>omc_create_task_from_json</code>
          <code>omc_update_task_from_json</code>
        </div>
      </section>

      <section className={styles.panel}>
        <div className={styles.panelHeader}>
          <span className={styles.panelIcon}><LuTerminal size={19} /></span>
          <div>
            <h2>Commands</h2>
            <p>These are the equivalent terminal commands for manual setup and restart.</p>
          </div>
        </div>
        <CodeBlock
          title="Codex install command"
          value={setup?.commands.codex ?? ''}
          copied={copied === 'codex-command'}
          onCopy={() => setup && copy('codex-command', setup.commands.codex)}
        />
        <CodeBlock
          title="Claude restart command"
          value={setup?.commands.claudeDesktopRestart ?? ''}
          copied={copied === 'claude-command'}
          onCopy={() => setup && copy('claude-command', setup.commands.claudeDesktopRestart)}
        />
      </section>
    </section>
  )
}

function CodeBlock({ title, value, copied, onCopy }: { title: string; value: string; copied: boolean; onCopy: () => void }) {
  return (
    <div className={styles.codeBlock}>
      <div>
        <span>{title}</span>
        <button type="button" onClick={onCopy} disabled={!value}>
          {copied ? <LuCheck size={14} /> : <LuClipboard size={14} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre>{value || 'Loading...'}</pre>
    </div>
  )
}
