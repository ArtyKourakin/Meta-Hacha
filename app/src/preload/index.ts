import { contextBridge, ipcRenderer } from 'electron'
import type { AnchorPoint, OverlayApi, StatusMessage } from '../shared/api'

function subscribe<T>(channel: string, cb: (value: T) => void): () => void {
  const listener = (_event: unknown, value: T): void => cb(value)
  ipcRenderer.on(channel, listener as (...args: unknown[]) => void)
  return () => ipcRenderer.removeListener(channel, listener as (...args: unknown[]) => void)
}

const api: OverlayApi = {
  submit: (target: string): void => ipcRenderer.send('input:submit', target),
  cancel: (): void => ipcRenderer.send('input:cancel'),
  onShowInput: (cb: (pos: AnchorPoint) => void): (() => void) =>
    subscribe<AnchorPoint>('overlay:show-input', cb),
  onHideInput: (cb: () => void): (() => void) =>
    subscribe<unknown>('overlay:hide-input', () => cb()),
  onLooking: (cb: (pos: AnchorPoint) => void): (() => void) =>
    subscribe<AnchorPoint>('overlay:looking', cb),
  onMarker: (cb: (pt: AnchorPoint) => void): (() => void) =>
    subscribe<AnchorPoint>('overlay:marker', cb),
  onMessage: (cb: (msg: StatusMessage) => void): (() => void) =>
    subscribe<StatusMessage>('overlay:message', cb)
}

contextBridge.exposeInMainWorld('api', api)
