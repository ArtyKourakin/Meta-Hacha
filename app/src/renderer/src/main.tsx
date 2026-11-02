import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import ChatApp from './ChatApp'
import HudApp from './HudApp'
import TabApp from './TabApp'
import './styles.css'

const root = document.getElementById('root')
if (!root) throw new Error('Missing #root element')

const hash = window.location.hash

// The HTML <title> overrides the BrowserWindow title option, so set it here.
document.title = 'SH-01'

createRoot(root).render(
  <React.StrictMode>
    {hash === '#tab' ? (
      <TabApp />
    ) : hash === '#chat' ? (
      <ChatApp />
    ) : hash === '#hud' ? (
      <HudApp />
    ) : (
      <App />
    )}
  </React.StrictMode>
)
