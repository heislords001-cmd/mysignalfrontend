import { Component } from 'react'
import type { ReactNode } from 'react'

export default class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) { return { error } }
  componentDidCatch(error: Error) { console.error(error) }
  render() {
    if (!this.state.error) return this.props.children
    return (
      <main className="login">
        <h2 style={{ margin: 0 }}>Something went wrong</h2>
        <p className="mu">Please reload the page.</p>
        <button className="btn" onClick={() => location.reload()}>Reload</button>
      </main>
    )
  }
}
