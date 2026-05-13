import React from 'react'

/**
 * Unified tile-style toggle used everywhere a binary on/off choice exists.
 * Replaces native <input type="checkbox"> for a consistent look across the app.
 *
 * Usage:
 *   <ToggleTile checked={x} onChange={setX} label="Auto-refresh" meta="hourly" />
 *   <ToggleTile checked={x} onChange={setX}>{customChildren}</ToggleTile>
 */
export default function ToggleTile({
  checked, onChange, label, meta, children, disabled, style,
}) {
  function handleClick() {
    if (disabled) return
    onChange(!checked)
  }
  function handleKey(e) {
    if (disabled) return
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault()
      onChange(!checked)
    }
  }
  return (
    <div
      role="checkbox"
      aria-checked={checked}
      tabIndex={disabled ? -1 : 0}
      onClick={handleClick}
      onKeyDown={handleKey}
      className={`tile-toggle${checked ? ' checked' : ''}`}
      style={{ opacity: disabled ? 0.5 : 1, cursor: disabled ? 'not-allowed' : 'pointer', ...style }}
    >
      <span className="tile-toggle-box">{checked ? '✓' : ''}</span>
      {children ? (
        children
      ) : (
        <span className="tile-toggle-label">
          {label}
          {meta && <span className="tile-toggle-meta" style={{ marginLeft: 6 }}>· {meta}</span>}
        </span>
      )}
    </div>
  )
}
