import React, { useState } from 'react'
import { FormatterPage } from './pages/FormatterPage'
import { ComparePage } from './pages/ComparePage'
import { ToastContainer } from './components/Toast'
import { useTheme } from './hooks/useTheme'
import { useToast } from './hooks/useToast'

export default function App() {
  const [tab, setTab] = useState('formatter')
  const { theme, toggle } = useTheme()
  const { toasts, toast } = useToast()

  return (
    <div className="app">
      <header className="header">
        <div className="header-left">
          <div className="logo">json<span>util</span></div>
          <nav className="nav-tabs">
            <button
              className={`nav-tab${tab === 'formatter' ? ' active' : ''}`}
              onClick={() => setTab('formatter')}
            >
              Formatter
            </button>
            <button
              className={`nav-tab${tab === 'compare' ? ' active' : ''}`}
              onClick={() => setTab('compare')}
            >
              Compare / Diff
            </button>
          </nav>
        </div>
        <div className="header-right">
          <button
            className="icon-btn"
            onClick={toggle}
            title="Toggle theme"
            aria-label="Toggle dark mode"
          >
            {theme === 'dark' ? '☀' : '☾'}
          </button>
        </div>
      </header>

      <main className="main">
        {tab === 'formatter' && <FormatterPage toast={toast} />}
        {tab === 'compare'   && <ComparePage toast={toast} />}
      </main>

      <ToastContainer toasts={toasts} />
    </div>
  )
}
