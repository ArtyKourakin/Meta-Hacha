import { contextBridge, ipcRenderer } from 'electron'
import type {
  AnchorPoint,
  AppApi,
  ChatSnapshot,
  InputPrompt,
  MarkerPoint,
  Rect,
  SaveCodeRequest,
  StatusMessage
} from '../shared/api'

function subscribe<T>(channel: string, cb: (value: T) => void): () => void {
  const listener = (_event: unknown, value: T): void => cb(value)
  ipcRenderer.on(channel, listener as (...args: unknown[]) => void)
  return () => ipcRenderer.removeListener(channel, listener as (...args: unknown[]) => void)
}

const api: AppApi = {
  submit: (target: string): void => ipcRenderer.send('input:submit', target),
  lookAsk: (text: string): void => ipcRenderer.send('look:ask', text),
  cancel: (): void => ipcRenderer.send('input:cancel'),
  onShowInput: (cb: (prompt: InputPrompt) => void): (() => void) =>
    subscribe<InputPrompt>('overlay:show-input', cb),
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
  onDismiss: (cb: () => void): (() => void) => subscribe<unknown>('overlay:dismiss', () => cb()),
  onIslandHover: (cb: (inside: boolean) => void): (() => void) =>
    subscribe<boolean>('overlay:island-hover', cb),
  reportIslands: (rects: Rect[]): void => ipcRenderer.send('islands:update', rects),
  bubbleNext: (): void => ipcRenderer.send('bubble:next'),
  bubbleRetry: (): void => ipcRenderer.send('bubble:retry'),
  bubbleDone: (): void => ipcRenderer.send('bubble:done'),
  bubbleWrongSpot: (): void => ipcRenderer.send('bubble:wrong-spot'),
  bubbleShowOption: (): void => ipcRenderer.send('bubble:show-option'),
  bubbleForceNext: (): void => ipcRenderer.send('bubble:force-next'),
  bubbleClose: (): void => ipcRenderer.send('bubble:close'),
  copyText: (text: string): void => ipcRenderer.send('copy:text', text),
  openSettings: (): void => ipcRenderer.send('settings:open'),
  chatReady: (): void => ipcRenderer.send('chat:ready'),
  chatSend: (text: string, withScreenshot: boolean): void =>
    ipcRenderer.send('chat:send', { text, withScreenshot }),
  chatShowMe: (): void => ipcRenderer.send('chat:show-me'),
  chatNext: (): void => ipcRenderer.send('chat:next'),
  chatBack: (): void => ipcRenderer.send('chat:back'),
  chatContinue: (): void => ipcRenderer.send('chat:continue'),
  chatToggleVerify: (): void => ipcRenderer.send('chat:toggle-verify'),
  chatToggleCollapsed: (source: 'button' | 'tab'): void =>
    ipcRenderer.send('chat:toggle-collapsed', source),
  chatSelectProject: (): void => ipcRenderer.send('chat:select-project'),
  chatCreateWorkspace: (name: string): void => ipcRenderer.send('chat:create-workspace', name),
  chatClearHistory: (): void => ipcRenderer.send('chat:clear-history'),
  chatDeleteAllHistory: (): void => ipcRenderer.send('chat:delete-all-history'),
  chatStartNew: (): void => ipcRenderer.send('chat:start-new'),
  chatAppReady: (): void => ipcRenderer.send('chat:app-ready'),
  chatSaveCode: (req: SaveCodeRequest): void => ipcRenderer.send('chat:save-code', req),
  chatNewChat: (): void => ipcRenderer.send('chat:new-chat'),
  chatSwitchChat: (id: string): void => ipcRenderer.send('chat:switch-chat', id),
  chatRenameChat: (id: string, title: string): void =>
    ipcRenderer.send('chat:rename-chat', { id, title }),
  chatDeleteChat: (id: string): void => ipcRenderer.send('chat:delete-chat', id),
  hudToggle: (): void => ipcRenderer.send('hud:toggle'),
  hudPause: (): void => ipcRenderer.send('hud:pause'),
  hudOpenChat: (): void => ipcRenderer.send('hud:open-chat'),
  hudHeight: (height: number): void => ipcRenderer.send('hud:height', height),
  openLink: (url: string): void => ipcRenderer.send('link:open', url),
  onTabCursor: (cb: (offset: AnchorPoint) => void): (() => void) =>
    subscribe<AnchorPoint>('chat:cursor', cb),
  onChatSnapshot: (cb: (snap: ChatSnapshot) => void): (() => void) =>
    subscribe<ChatSnapshot>('chat:snapshot', cb)
}

contextBridge.exposeInMainWorld('api', api)
