// Shared net-worth time-series builder.
// Both NetWorthHistory.jsx and the Dashboard mini-chart use this so the two
// charts always agree. Without it, the dashboard's "30D / 12W / 12M / 5Y"
// pills can collapse onto each other when the user has only sparse saved
// snapshots — because they were filtering raw snapshots instead of
// reconstructing per-period from transactions.

import { computeNetWorthAsOf, todayISO } from './calculations.js'

// ── Date helpers (UTC so day boundaries are timezone-stable) ────────────────
function isoAddDays(iso, days) {
  const d = new Date(iso + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}
function snapAtOrBefore(sortedAsc, iso) {
  let last = null
  for (const s of sortedAsc) {
    if (s.date > iso) break
    last = s
  }
  return last
}

// ── Densifiers (carry forward last known value) ─────────────────────────────
export function makeDaily(sortedAsc, days) {
  const out = []
  const end = todayISO()
  const start = isoAddDays(end, -days + 1)
  const first = sortedAsc[0]
  for (let i = 0; i < days; i++) {
    const iso = isoAddDays(start, i)
    const base = snapAtOrBefore(sortedAsc, iso) || first
    if (!base) continue
    out.push({ date: iso, totalAssets: base.totalAssets, totalLiabilities: base.totalLiabilities, netWorth: base.netWorth })
  }
  return out
}
export function makeWeekly(sortedAsc, weeks) {
  const out = []
  const today = new Date(todayISO() + 'T00:00:00Z')
  const day = today.getUTCDay()
  const monOffset = day === 0 ? -6 : 1 - day
  const thisMon = new Date(today)
  thisMon.setUTCDate(today.getUTCDate() + monOffset)
  const first = sortedAsc[0]
  for (let i = weeks - 1; i >= 0; i--) {
    const d = new Date(thisMon)
    d.setUTCDate(thisMon.getUTCDate() - i * 7)
    let iso = d.toISOString().slice(0, 10)
    if (i === 0) iso = todayISO() // current week-in-progress shows live today
    const base = snapAtOrBefore(sortedAsc, iso) || first
    if (!base) continue
    out.push({ date: iso, totalAssets: base.totalAssets, totalLiabilities: base.totalLiabilities, netWorth: base.netWorth })
  }
  return out
}
export function makeMonthly(sortedAsc, months) {
  // Use START-of-month anchors so data points land exactly on the x-axis
  // monthly tick positions. The current month uses TODAY (live tip).
  const out = []
  const today = new Date(todayISO() + 'T00:00:00Z')
  const first = sortedAsc[0]
  for (let i = months - 1; i >= 0; i--) {
    let iso
    if (i === 0) {
      iso = todayISO() // live current value
    } else {
      const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - i, 1))
      iso = d.toISOString().slice(0, 10)
    }
    const base = snapAtOrBefore(sortedAsc, iso) || first
    if (!base) continue
    out.push({ date: iso, totalAssets: base.totalAssets, totalLiabilities: base.totalLiabilities, netWorth: base.netWorth })
  }
  return out
}
export function makeYearly(sortedAsc, years) {
  // Use Jan 1 anchors so data points line up with yearly x-axis ticks.
  // Current year uses TODAY for a live tip.
  const out = []
  const today = new Date(todayISO() + 'T00:00:00Z')
  const first = sortedAsc[0]
  for (let i = years - 1; i >= 0; i--) {
    const y = today.getUTCFullYear() - i
    const iso = (y === today.getUTCFullYear()) ? todayISO() : `${y}-01-01`
    const base = snapAtOrBefore(sortedAsc, iso) || first
    if (!base) continue
    out.push({ date: iso, totalAssets: base.totalAssets, totalLiabilities: base.totalLiabilities, netWorth: base.netWorth })
  }
  return out
}

// Build the union of saved snapshots + month-by-month reconstructed points
// from the earliest event date to today. Saved snapshots take precedence.
//
// IMPORTANT: reconstructed points use START-OF-MONTH dates (the 1st) to
// match what `makeMonthly` / `makeYearly` later look up. If we used end-of-
// month dates, a "March 1" sample on the chart would silently fall back to
// the "Feb 28" value via snapAtOrBefore — making every data point look ~1
// month behind its x-axis tick.
export function buildNetWorthSeries(data, baseCurrency, currentTotals) {
  if (!data.assets?.length && !data.liabilities?.length) return []
  const reconstructed = []
  const today = new Date(todayISO() + 'T00:00:00Z')
  const dates = [
    ...(data.transactions || []).map(t => t.date).filter(Boolean),
    ...(data.assets || []).map(a => a.purchaseDate).filter(Boolean),
  ].sort()
  const earliest = dates[0] || todayISO()
  const start = new Date(earliest + 'T00:00:00Z')
  // Walk every month from the FIRST of the earliest month through today,
  // reconstructing the value AS OF that 1st-of-month date.
  const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1))
  while (cursor <= today) {
    const iso = cursor.toISOString().slice(0, 10)
    reconstructed.push(computeNetWorthAsOf(data, iso, baseCurrency))
    cursor.setUTCMonth(cursor.getUTCMonth() + 1)
  }
  // Always include the absolute earliest event date as the starting anchor
  // (so the line begins where activity begins, not at the 1st of that month).
  if (reconstructed[0]?.date !== earliest) {
    reconstructed.unshift(computeNetWorthAsOf(data, earliest, baseCurrency))
  }
  // Densify the recent 6 months with DAILY reconstructions so the 30D / 3M
  // views (which sample weekly + daily) don't show staircase plateaus that
  // jump only at month boundaries. Without this, makeWeekly's "Monday at-or-
  // before" lookup falls back to the prior month-start anchor for any
  // Monday that isn't the 1st, and several weeks in a row render at the
  // same value — making the chart look stuck and then leap to today.
  const denseStart = new Date(today)
  denseStart.setUTCMonth(today.getUTCMonth() - 6)
  // Only daily-densify dates AT OR AFTER the earliest activity date —
  // before that, net worth is genuinely zero and flat.
  const earliestDate = new Date(earliest + 'T00:00:00Z')
  const denseFrom = denseStart < earliestDate ? earliestDate : denseStart
  const denseCursor = new Date(Date.UTC(denseFrom.getUTCFullYear(), denseFrom.getUTCMonth(), denseFrom.getUTCDate()))
  while (denseCursor <= today) {
    const iso = denseCursor.toISOString().slice(0, 10)
    // Skip if we already have this exact ISO (avoid duplicate month-anchor points)
    if (!reconstructed.some(p => p.date === iso)) {
      reconstructed.push(computeNetWorthAsOf(data, iso, baseCurrency))
    }
    denseCursor.setUTCDate(denseCursor.getUTCDate() + 1)
  }
  reconstructed.sort((a, b) => a.date.localeCompare(b.date))
  // Anchor today with live totals so the chart tip matches the metric cards.
  if (currentTotals) {
    const lastIdx = reconstructed.findIndex(p => p.date === todayISO())
    const liveSnap = {
      date: todayISO(),
      totalAssets: currentTotals.totalAssetsBase,
      totalLiabilities: currentTotals.totalLiabilitiesBase,
      netWorth: currentTotals.netWorthBase,
    }
    if (lastIdx >= 0) reconstructed[lastIdx] = liveSnap
    else reconstructed.push(liveSnap)
  }
  // Merge strategy: reconstruction is the source of truth (it replays every
  // transaction with current prices). Saved snapshots are noisy — they were
  // captured when the user had less data and now look like deep dips on the
  // chart. We compute reconstruction at EVERY saved-snapshot date and use it
  // to filter out stale ones (drift > 25% means the snapshot is obsolete).
  const byDate = {}
  for (const p of reconstructed) byDate[p.date] = p
  for (const s of (data.snapshots || [])) {
    // Compute the reconstructed equivalent at the saved snapshot's date.
    const reconAtDate = byDate[s.date] || computeNetWorthAsOf(data, s.date, baseCurrency)
    const denom = Math.max(Math.abs(reconAtDate.netWorth), 1)
    const drift = Math.abs(s.netWorth - reconAtDate.netWorth) / denom
    if (drift < 0.25) {
      // Fresh: prefer the saved snapshot (it captured a real intra-day value)
      byDate[s.date] = s
    } else {
      // Stale: drop the saved value and use the reconstructed one instead
      byDate[s.date] = reconAtDate
    }
  }
  return Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date))
}
