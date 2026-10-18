import { Component } from 'react'
import type { ReactNode } from 'react'

export default class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) { return { error } }
  render() {
    if (!this.state.error) return this.props.children
    return (
      <main className="login">
        <h2 style={{ margin: 0 }}>Something went wrong</h2>
        <p className="mu">The page hit an error. Send this message to whoever built the site:</p>
        <div className="card"><code style={{ wordBreak: 'break-word' }}>{this.state.error.message}</code></div>
        <button className="btn" onClick={() => location.reload()}>Reload</button>
      </main>
    )
  }
}
