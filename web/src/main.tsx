import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

// Apply persisted theme before paint to avoid a flash.
try {
  const raw = localStorage.getItem('absentra_ui_v1')
  const theme = raw ? JSON.parse(raw)?.state?.theme : 'light'
  document.documentElement.setAttribute('data-theme', theme === 'dark' ? 'dark' : 'light')
} catch {
  document.documentElement.setAttribute('data-theme', 'light')
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
