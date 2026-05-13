import { useState, useEffect } from 'react'

const STORAGE_KEY = 'portfolio-theme'

// Shared theme state. Previously every useTheme() instance held its own
// useState, so toggling theme in the sidebar didn't notify chart components —
// their `key={theme}` prop never changed, Chart.js kept the old palette,
// and the user saw a half-repainted UI until reload. Now a module-level
// subscriber set fans out every change to every mounted useTheme() caller.
let currentTheme = (() => {
  try { return localStorage.getItem(STORAGE_KEY) || 'dark' } catch { return 'dark' }
})()
const subscribers = new Set()

function applyTheme(next) {
  currentTheme = next
  try { localStorage.setItem(STORAGE_KEY, next) } catch {}
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('data-theme', next)
  }
  for (const fn of subscribers) fn(next)
}

// Apply the initial theme to <html> on first import so CSS variables are
// correct before the first render (avoids a flash of the wrong palette).
if (typeof document !== 'undefined') {
  document.documentElement.setAttribute('data-theme', currentTheme)
}

export function useTheme() {
  const [theme, setLocal] = useState(currentTheme)

  useEffect(() => {
    subscribers.add(setLocal)
    // Sync up in case the theme changed between render and effect.
    if (theme !== currentTheme) setLocal(currentTheme)
    return () => { subscribers.delete(setLocal) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const setTheme = (next) => applyTheme(next)
  const toggle = () => applyTheme(currentTheme === 'dark' ? 'light' : 'dark')

  return { theme, setTheme, toggle }
}
