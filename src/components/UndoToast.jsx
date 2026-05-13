import React, { useEffect, useState } from 'react'
import { usePortfolio } from '../context/PortfolioContext.jsx'

/**
 * Floating "Undo" toast. Appears when the most recent entry in the undo stack
 * is less than 8 seconds old. Clicking "Undo" restores the prior state.
 */
export default function UndoToast() {
  const { undoStack, undoLast } = usePortfolio()
  const [, force] = useState(0)
  const top = undoStack[0]

  // Tick so the toast disappears after TTL without a manual refresh
  useEffect(() => {
    if (!top) return
    const t = setInterval(() => force(x => x + 1), 1000)
    return () => clearInterval(t)
  }, [top])

  const TTL = 8000
  if (!top || (Date.now() - top.at) > TTL) return null

  return (
    <div className="undo-toast">
      <span>{top.label}</span>
      <button className="btn btn-xs btn-primary" onClick={undoLast}>↶ Undo</button>
    </div>
  )
}
