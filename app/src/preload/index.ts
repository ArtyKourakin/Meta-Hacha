import { contextBridge, ipcRenderer } from 'electron'
import type { AnchorPoint, AppApi, ChatSnapshot, MarkerPoint, StatusMessage } from '../shared/api'

function subscribe<T>(channel: string, cb: (value: T) => void): () => void {
  const listener = (_event: unknown, value: T): void => cb(value)
  ipcRenderer.on(channel, listener as (...args: unknown[]) => void)
  return () => ipcRenderer.removeListener(channel, listener as (...args: unknown[]) => void)
}

const api: AppApi = {
  submit: (target: string): void => ipcRenderer.send('input:submit', target),
  cancel: (): void => ipcRenderer.send('input:cancel'),
  onShowInput: (cb: (pos: AnchorPoint) => void): (() => void) =>
    subscribe<AnchorPoint>('overlay:show-input', cb),
  onHideInput: (cb: () => void): (() => void) =>
    subscribe<unknown>('overlay:hide-input', () => cb()),
  onLooking: (cb: (pos: AnchorPoint) => void): (() => void) =>
    subscribe<AnchorPoint>('overlay:looking', cb),
  onLookingDone: (cb: () => void): (() => void) =>
    subscribe<unknown>('overlay:looking-done', () => cb()),
  onMarker: (cb: (pt: MarkerPoint) => void): (() => void) =>
    subscribe<MarkerPoint>('overlay:marker', cb),
  onMessage: (cb: (msg: StatusMessage) => void): (() => void) =>
    subscribe<StatusMessage>('overlay:message', cb),
  onHappy: (cb: () => void): (() => void) => subscribe<unknown>('overlay:happy', () => cb()),
  hoverBubble: (hovering: boolean): void => ipcRenderer.send('bubble:hover', hovering),
  bubbleNext: (): void => ipcRenderer.send('bubble:next'),
  bubbleRetry: (): void => ipcRenderer.send('bubble:retry'),
  bubbleDone: (): void => ipcRenderer.send('bubble:done'),
  openSettings: (): void => ipcRenderer.send('settings:open'),
  chatReady: (): void => ipcRenderer.send('chat:ready'),
  chatSend: (text: string, withScreenshot: boolean): void =>
    ipcRenderer.send('chat:send', { text, withScreenshot }),
  chatShowMe: (): void => ipcRenderer.send('chat:show-me'),
  chatNext: (): void => ipcRenderer.send('chat:next'),
  chatBack: (): void => ipcRenderer.send('chat:back'),
  onChatSnapshot: (cb: (snap: ChatSnapshot) => void): (() => void) =>
    subscribe<ChatSnapshot>('chat:snapshot', cb)
}

contextBridge.exposeInMainWorld('api', api)
