import { useEffect } from 'react'
import TabFace from './TabFace'

/** Collapsed tab window (#tab route). Fixed size, transparent outside the panel. */
export default function TabApp() {
  // Belt and suspenders: the rounded corners must show no square edges.
  useEffect(() => {
    document.documentElement.style.background = 'transparent'
    document.body.style.background = 'transparent'
    document.getElementById('root')?.style.setProperty('background', 'transparent')
  }, [])

  return (
    <div
      className="tab-root"
      role="button"
      tabIndex={0}
      aria-label="Expand SH-01 panel"
      onClick={() => window.api.chatToggleCollapsed('tab')}
      onKeyDown={(e) => {
        if (e.key === 'Enter') window.api.chatToggleCollapsed('tab')
      }}
    >
      <TabFace />
      <div className="tab-label">SH-01</div>
    </div>
  )
}
