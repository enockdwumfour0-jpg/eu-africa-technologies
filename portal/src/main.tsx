import React, { Component, type ReactNode } from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { AuthProvider } from './auth/AuthContext'
import { FeedbackProvider } from './components/ui'
import './index.css'

// If a page ever fails to render, show a message and a way back instead of a blank screen.
class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(e: unknown) { console.error('Page error', e) }
  render() {
    if (!this.state.failed) return this.props.children
    return (
      <div style={{ maxWidth: 480, margin: '15vh auto', padding: 24, fontFamily: 'system-ui, sans-serif', textAlign: 'center' }}>
        <h1 style={{ fontSize: 20, marginBottom: 8 }}>Something went wrong</h1>
        <p style={{ color: '#555', marginBottom: 16 }}>This page could not be shown. Please reload. If it keeps happening, contact EU-AFRIC support.</p>
        <button onClick={() => { window.location.reload() }} style={{ background: '#168447', color: '#fff', border: 0, borderRadius: 6, padding: '10px 18px', cursor: 'pointer' }}>Reload</button>
      </div>
    )
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Boundary>
      <BrowserRouter>
        <AuthProvider>
          <FeedbackProvider>
            <App />
          </FeedbackProvider>
        </AuthProvider>
      </BrowserRouter>
    </Boundary>
  </React.StrictMode>,
)
