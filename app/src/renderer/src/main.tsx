import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import ChatApp from './ChatApp'
import './styles.css'

const root = document.getElementById('root')
if (!root) throw new Error('Missing #root element')

const isChat = window.location.hash === '#chat'

// The HTML <title> overrides the BrowserWindow title option, so set it here.
document.title = 'SH-0'

createRoot(root).render(
  <React.StrictMode>
    {isChat ? <ChatApp /> : <App />}
  </React.StrictMode>
)
