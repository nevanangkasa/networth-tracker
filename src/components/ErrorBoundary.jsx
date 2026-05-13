import React from 'react'

// React error boundary that catches render-time exceptions and shows a
// recovery UI instead of a blank white screen. The portfolio data lives in a
// JSON file on disk, so even if the UI crashes, no data is lost. This
// component lets users export their data, reset the app, or refresh — all
// without losing what they've entered.
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { error: null, info: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    this.setState({ info })
    // Console log so developers can grab it. We don't ship this anywhere —
    // local-first means no analytics, no error reporting service.
    console.error('Caught render error:', error, info)
  }

  async copyDiagnostics() {
    const lines = [
      'Portfolio Tracker — diagnostic dump',
      `Generated: ${new Date().toISOString()}`,
      `User Agent: ${navigator.userAgent}`,
      '',
      `Error: ${this.state.error?.message || 'unknown'}`,
      '',
      'Stack:',
      this.state.error?.stack || '(no stack)',
      '',
      'Component stack:',
      this.state.info?.componentStack || '(no component stack)',
    ].join('\n')
    try {
      await navigator.clipboard.writeText(lines)
      alert('Diagnostic info copied to clipboard.')
    } catch {
      // Fallback: open in a new window so user can copy manually
      const w = window.open('', '_blank')
      if (w) { w.document.body.innerText = lines }
    }
  }

  async exportBackup() {
    try {
      const res = await fetch('/api/data')
      const json = await res.json()
      const blob = new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `portfolio-backup-${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      alert('Could not reach the backend to export. Try refreshing first.')
    }
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div style={{
        maxWidth: 640, margin: '60px auto', padding: '32px 24px',
        background: 'var(--card, #1e2329)', color: 'var(--text, #eaecef)',
        borderRadius: 12, border: '1px solid var(--border, #2b3139)',
        fontFamily: 'Inter, system-ui, sans-serif', lineHeight: 1.6,
      }}>
        <div style={{ fontSize: 32, marginBottom: 12 }}>⚠</div>
        <h1 style={{ fontSize: 22, marginBottom: 8 }}>Something went wrong</h1>
        <p style={{ color: 'var(--text-muted, #8a8678)', marginBottom: 16 }}>
          The app hit an unexpected error while rendering. <strong>Your data is safe</strong> — it's
          saved on disk and untouched. You can export a backup, then refresh.
        </p>
        <pre style={{
          background: 'var(--bg, #0F1115)', padding: 12, borderRadius: 6,
          fontSize: 12, overflow: 'auto', maxHeight: 200,
          color: 'var(--loss, #f43f5e)',
        }}>{this.state.error.message || String(this.state.error)}</pre>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 16 }}>
          <button
            onClick={() => this.exportBackup()}
            style={{ padding: '8px 14px', borderRadius: 6, border: 'none',
              background: 'var(--accent, #1F6C58)', color: 'white', cursor: 'pointer', fontWeight: 600 }}
          >⬇ Export backup</button>
          <button
            onClick={() => this.copyDiagnostics()}
            style={{ padding: '8px 14px', borderRadius: 6,
              border: '1px solid var(--border, #2b3139)', background: 'transparent',
              color: 'var(--text, #eaecef)', cursor: 'pointer' }}
          >Copy diagnostic info</button>
          <button
            onClick={() => window.location.reload()}
            style={{ padding: '8px 14px', borderRadius: 6, border: 'none',
              background: 'var(--accent, #1F6C58)', color: 'white', cursor: 'pointer', fontWeight: 600 }}
          >↻ Reload app</button>
        </div>
        <p style={{ fontSize: 11, color: 'var(--text-muted, #8a8678)', marginTop: 20 }}>
          If this keeps happening, copy the diagnostic info above and check
          your <code>portfolio.json</code> file for invalid edits.
        </p>
      </div>
    )
  }
}
