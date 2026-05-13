import React, { useMemo, useState } from 'react'
import { Line } from 'react-chartjs-2'
import {
  Chart as ChartJS, CategoryScale, LinearScale, TimeScale, PointElement,
  LineElement, Tooltip, Filler,
} from 'chart.js'
import 'chartjs-adapter-date-fns'
import { formatCurrency, todayISO } from '../../utils/calculations.js'
import { isoToLocalTs, formatTick, formatTooltipDate } from '../../utils/chartDates.js'
import { useTheme } from '../../hooks/useTheme.js'

ChartJS.register(CategoryScale, LinearScale, TimeScale, PointElement, LineElement, Tooltip, Filler)

/**
 * Reusable timeframe chart for the Income & Markets pages.
 *
 * Design rules (consistent across every chart in the app):
 * 1. Every visible window is filled with a UNIFORM grid of datapoints —
 *    daily for ≤ 35 days, weekly for ≤ 6 months, monthly otherwise. We
 *    NEVER show only "start" and "end" anchors.
 * 2. For each grid point we look up the value at that date by carrying the
 *    most-recent known sample forward. Cumulative-mode also accumulates
 *    events that happened on or before the grid date.
 * 3. The x-axis is a real time scale, with ticks forced onto natural
 *    calendar boundaries (Jan 1, Mon, 1st of month, etc.) — never mid-month.
 * 4. The line uses monotone interpolation (no bezier overshoot).
 */
const TIMEFRAMES = [
  { id: '1W',  label: '1W'  },
  { id: '3M',  label: '3M'  },
  { id: '12M', label: '12M' },
  { id: 'YTD', label: 'YTD' },
  { id: 'ALL', label: 'All' },
]

// ─── Date helpers (LOCAL time so they line up with Chart.js's tick generator)
function localToday() {
  const t = todayISO().split('-').map(Number)
  return new Date(t[0], t[1] - 1, t[2])
}
function addDays(d, n) {
  const x = new Date(d); x.setDate(x.getDate() + n); return x
}
function addMonths(d, n) {
  const x = new Date(d); x.setMonth(x.getMonth() + n); return x
}
function addYears(d, n) {
  const x = new Date(d); x.setFullYear(x.getFullYear() + n); return x
}
// Local-midnight ISO (YYYY-MM-DD) of a Date
function isoOf(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}
function startOfWeek(d) {
  const x = new Date(d); const dow = x.getDay() || 7
  x.setDate(x.getDate() - (dow - 1))
  return new Date(x.getFullYear(), x.getMonth(), x.getDate())
}
function startOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1) }
function startOfYear(d)  { return new Date(d.getFullYear(), 0, 1) }

// Window start, given a timeframe id and the earliest data date.
function windowStart(tf, earliestISO) {
  const today = localToday()
  switch (tf) {
    case '1W':  return addDays(today, -7 + 1)
    case '3M':  return addMonths(today, -3)
    case '12M': return addMonths(today, -12)
    case 'YTD': return startOfYear(today)
    case 'ALL': return earliestISO
      ? (() => { const [y,m,d] = earliestISO.split('-').map(Number); return new Date(y, m-1, d) })()
      : today
    default:    return addMonths(today, -1)
  }
}

// Choose the sampling step for a given timeframe.
// CRITICAL: step === unit, so grid points and tick labels land on the same
// calendar anchors (1st of month, Monday of week, Jan 1 of year). This is
// what makes the line's inflections sit exactly on the x-axis ticks.
function gridSpec(tf, spanDays) {
  if (tf === '1W')  return { step: 'day',   unit: 'day'   }
  if (tf === '3M')  return { step: 'week',  unit: 'week'  }
  if (tf === '12M') return { step: 'month', unit: 'month' }
  if (tf === 'YTD') {
    if (spanDays <= 35) return { step: 'day',   unit: 'day' }
    if (spanDays <= 95) return { step: 'week',  unit: 'week' }
    return                     { step: 'month', unit: 'month' }
  }
  // ALL
  if (spanDays > 365 * 3) return { step: 'year',  unit: 'year' }
  if (spanDays > 180)     return { step: 'month', unit: 'month' }
  if (spanDays > 35)      return { step: 'week',  unit: 'week' }
  return { step: 'day', unit: 'day' }
}

function advance(d, step) {
  if (step === 'day')   return addDays(d, 1)
  if (step === 'week')  return addDays(d, 7)
  if (step === 'month') return addMonths(d, 1)
  if (step === 'year')  return addYears(d, 1)
  return addDays(d, 1)
}

// Snap a date DOWN to the start of its unit so the FIRST grid point lands
// on a natural calendar anchor (Jan 1 of year, 1st of month, Monday of week).
function snapDownTo(d, step) {
  if (step === 'day')   return new Date(d.getFullYear(), d.getMonth(), d.getDate())
  if (step === 'week')  return startOfWeek(d)
  if (step === 'month') return startOfMonth(d)
  if (step === 'year')  return startOfYear(d)
  return new Date(d)
}

export default function EarningsTimeframeChart({
  series, baseCurrency, title, mode = 'cumulative', height = 220,
}) {
  const { theme } = useTheme()
  const [tf, setTf] = useState('12M')

  // Sort & dedupe input series by date (sum same-day events for cumulative).
  const sorted = useMemo(() => {
    const arr = (series || []).filter(p => p && p.date).slice()
    arr.sort((a, b) => a.date.localeCompare(b.date))
    return arr
  }, [series])

  // ── Build a uniform sample grid for the selected window ───────────────────
  // Each grid point lands on a natural calendar anchor that matches the
  // x-axis tick unit (1st of month, Monday, Jan 1, …). The final point is
  // ALWAYS today so the chart tip reflects the current value live.
  const gridPoints = useMemo(() => {
    if (!sorted.length) return []
    const earliest = sorted[0].date
    const requestedStart = windowStart(tf, earliest)
    const today = localToday()
    const spanDays = Math.max(1, (today - requestedStart) / 86_400_000)
    const { step } = gridSpec(tf, spanDays)

    // Snap window start UP to the next anchor on/after the requested start so
    // every grid point sits on a calendar boundary. (Snap-down would put the
    // first point earlier than the user-requested window.)
    let cursor = snapDownTo(requestedStart, step)
    if (cursor < requestedStart) cursor = advance(cursor, step)

    const todayISOStr = isoOf(today)

    if (mode === 'cumulative') {
      // Running sum: at each anchor date we report the total accumulated up
      // to and including that date. Single pass for O(n) cost.
      let acc = 0
      let idx = 0
      const points = []
      const pushAt = (date) => {
        const cISO = isoOf(date)
        while (idx < sorted.length && sorted[idx].date <= cISO) {
          acc += Number(sorted[idx].value) || 0
          idx++
        }
        points.push({ x: date.getTime(), y: acc })
      }
      while (cursor < today) {
        pushAt(cursor)
        cursor = advance(cursor, step)
      }
      // Always end exactly at today, even if today isn't a calendar anchor
      pushAt(today)
      return points
    }

    // mode === 'value' — carry forward the most recent known sample value.
    let lastKnown = 0
    for (let i = sorted.length - 1; i >= 0; i--) {
      if (sorted[i].date <= isoOf(requestedStart)) { lastKnown = Number(sorted[i].value) || 0; break }
    }
    let idx = 0
    while (idx < sorted.length && sorted[idx].date < isoOf(requestedStart)) idx++
    const points = []
    const pushAt = (date) => {
      const cISO = isoOf(date)
      while (idx < sorted.length && sorted[idx].date <= cISO) {
        lastKnown = Number(sorted[idx].value) || 0
        idx++
      }
      points.push({ x: date.getTime(), y: lastKnown })
    }
    while (cursor < today) {
      pushAt(cursor)
      cursor = advance(cursor, step)
    }
    pushAt(today)
    return points
  }, [sorted, tf, mode])

  // ── Per-pill stat (change over each window) ────────────────────────────────
  const tfStats = useMemo(() => {
    const out = {}
    if (!sorted.length) return out
    const earliest = sorted[0].date
    for (const t of TIMEFRAMES) {
      const start = windowStart(t.id, earliest)
      const startISO = isoOf(start)
      if (mode === 'cumulative') {
        const v = sorted
          .filter(p => p.date >= startISO)
          .reduce((s, p) => s + (Number(p.value) || 0), 0)
        out[t.id] = v
      } else {
        const before = [...sorted].reverse().find(p => p.date < startISO)
        const last = sorted[sorted.length - 1]
        const baseline = before ? before.value : (sorted.find(p => p.date >= startISO)?.value ?? last.value)
        out[t.id] = (last?.value ?? 0) - baseline
      }
    }
    return out
  }, [sorted, mode])

  // ── Theme tokens ──────────────────────────────────────────────────────────
  const css = typeof document !== 'undefined' ? getComputedStyle(document.documentElement) : null
  const accent = css?.getPropertyValue('--accent').trim() || '#1F6C58'
  const gridColor = css?.getPropertyValue('--chart-grid').trim() || 'rgba(0,0,0,0.06)'
  const cardBg = css?.getPropertyValue('--card').trim() || '#fff'
  const borderCol = css?.getPropertyValue('--border').trim() || '#e8e2d5'
  const textCol = css?.getPropertyValue('--text').trim() || '#0F1115'
  const mutedCol = css?.getPropertyValue('--text-muted').trim() || '#8a8678'

  const earliest = sorted[0]?.date
  const spanDays = gridPoints.length >= 2
    ? (gridPoints[gridPoints.length - 1].x - gridPoints[0].x) / 86_400_000
    : 0
  const { unit } = gridSpec(tf, spanDays)

  // Force the time scale to start ticks on a natural calendar boundary.
  // Without this Chart.js anchors ticks to the first datapoint, which is why
  // a "12M" view starting on April 26 had ticks at "Apr, May, … " instead of
  // "Jan, Feb, …" — the user's exact complaint.
  const xMin = (() => {
    if (!gridPoints.length) return undefined
    const start = new Date(gridPoints[0].x)
    if (unit === 'year')  return startOfYear(start).getTime()
    if (unit === 'month') return startOfMonth(start).getTime()
    if (unit === 'week')  return startOfWeek(start).getTime()
    return start.getTime()
  })()
  const xMax = localToday().getTime()

  const chartData = {
    datasets: [{
      label: title || 'Value',
      data: gridPoints,
      borderColor: accent,
      backgroundColor: accent + '22',
      fill: true,
      cubicInterpolationMode: 'monotone',
      tension: 0,
      pointRadius: 0,
      pointHoverRadius: 5,
      pointBackgroundColor: accent,
      borderWidth: 2,
    }]
  }

  // Both axis and tooltip are formatted in LOCAL time. Combined with our
  // local-midnight data timestamps, this means: ISO date in data → calendar
  // date on axis → calendar date in tooltip — all identical.

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: cardBg, borderColor: borderCol, borderWidth: 1,
        titleColor: textCol, bodyColor: mutedCol, padding: 10,
        callbacks: {
          title: (items) => formatTooltipDate(items[0].parsed.x),
          label: (ctx) => ` ${formatCurrency(ctx.parsed.y, baseCurrency, true)}`,
        }
      }
    },
    scales: {
      x: {
        type: 'time',
        min: xMin,
        max: xMax,
        time: {
          unit,
          stepSize: 1,
        },
        grid: { color: gridColor, drawBorder: false },
        ticks: {
          color: mutedCol, font: { size: 11 },
          maxRotation: 0,
          autoSkip: true,
          autoSkipPadding: 16,
          source: 'auto',
          // Force UTC formatting for both axis and tooltip so what you see
          // on the axis exactly matches the date in the tooltip and the
          // underlying ISO calendar date in your data.
          callback: (value) => formatTick(value, unit),
        },
        border: { display: false },
      },
      y: {
        grid: { color: gridColor, drawBorder: false },
        ticks: { color: mutedCol, font: { size: 11 }, callback: v => formatCurrency(v, baseCurrency, true) },
        border: { display: false },
      }
    }
  }

  return (
    <div className="card">
      <div className="card-header" style={{ flexWrap: 'wrap', gap: 8 }}>
        <span className="card-title">{title}</span>
        <div style={{ display: 'flex', gap: 4 }}>
          {TIMEFRAMES.map(t => (
            <button
              key={t.id}
              className={`btn btn-xs ${tf === t.id ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setTf(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Stat strip — change in each timeframe */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(5, minmax(0, 1fr))',
          gap: 8,
          marginBottom: 12,
        }}
      >
        {TIMEFRAMES.map(t => {
          const v = tfStats[t.id] || 0
          const cls = v > 0 ? 'gain' : v < 0 ? 'loss' : ''
          const sign = v > 0 ? '+' : ''
          return (
            <button
              key={t.id}
              onClick={() => setTf(t.id)}
              className={tf === t.id ? 'tile-toggle checked' : 'tile-toggle'}
              style={{
                flexDirection: 'column', alignItems: 'flex-start', gap: 2,
                padding: '8px 10px', textAlign: 'left',
              }}
            >
              <span style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 600, letterSpacing: '0.05em' }}>
                {t.label}
              </span>
              <span className={cls} style={{ fontSize: 14, fontWeight: 600 }}>
                {v === 0 ? formatCurrency(0, baseCurrency, true) : `${sign}${formatCurrency(v, baseCurrency, true)}`}
              </span>
            </button>
          )
        })}
      </div>

      {sorted.length === 0 || gridPoints.length === 0 ? (
        <div className="empty-state" style={{ padding: '24px 0' }}>
          <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>No data yet</p>
        </div>
      ) : (
        <div style={{ height }}>
          <Line key={`${theme}-${tf}`} data={chartData} options={options} />
        </div>
      )}
    </div>
  )
}
