/** Shared preload bridge contract (no Electron imports, safe for the renderer). */

export interface AnchorPoint {
  x: number
  y: number
}

export interface StatusMessage extends AnchorPoint {
  text: string
}

export interface OverlayApi {
  submit: (target: string) => void
  cancel: () => void
  onShowInput: (cb: (pos: AnchorPoint) => void) => () => void
  onHideInput: (cb: () => void) => () => void
  onLooking: (cb: (pos: AnchorPoint) => void) => () => void
  onMarker: (cb: (pt: AnchorPoint) => void) => () => void
  onMessage: (cb: (msg: StatusMessage) => void) => () => void
}
