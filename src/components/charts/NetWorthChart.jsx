import React from 'react'
import { Line } from 'react-chartjs-2'
import {
  Chart as ChartJS, CategoryScale, LinearScale, TimeScale, PointElement,
  LineElement, Title, Tooltip, Filler
} from 'chart.js'
import 'chartjs-adapter-date-fns'
import { formatCurrency, todayISO, localISO } from '../../utils/calculations.js'
import { isoToLocalTs, formatTick, formatTooltipDate } from '../../utils/chartDates.js'
import { useTheme } from '../../hooks/useTheme.js'

ChartJS.register(CategoryScale, LinearScale, TimeScale, PointElement, LineElement, Title, Tooltip, Filler)

// Pick a natural tick unit based on the visible date range so axes stay
// uniform — yearly view never mixes "Jan 1 25 / Jan 1 26 / Apr 23 26" together.
function pickUnit(spanDays) {
  if (spanDays > 365 * 3)   return 'year'
  if (spanDays > 180)       return 'month'
  if (spanDays > 35)        return 'week'
  return 'day'
}
// Snap a timestamp DOWN to the start of the unit so the first tick lands on
// a natural calendar boundary (Jan 1 / Mon / 1st of month / Jan 1 of year).
// Operates in LOCAL time to match how Chart.js places ticks.
function snapDown(ts, unit) {
  const d = new Date(ts)
  if (unit === 'year')  return new Date(d.getFullYear(), 0, 1).getTime()
  if (unit === 'month') return new Date(d.getFullYear(), d.getMonth(), 1).getTime()
  if (unit === 'week') {
    const dow = d.getDay() || 7
    const x = new Date(d)
    x.setDate(x.getDate() - (dow - 1))
    return new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  }
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

export default function NetWorthChart({ snapshots, baseCurrency, height = 220 }) {
  const { theme } = useTheme()
  const rawSorted = [...snapshots].sort((a, b) => a.date.localeCompare(b.date))

  if (rawSorted.length === 0) {
    return (
      <div className="empty-state" style={{ padding: '24px 0' }}>
        <div style={{ fontSize: 32, marginBottom: 8 }}>∿</div>
        <p>Add more snapshots to see your net worth over time</p>
      </div>
    )
  }

  // With a single snapshot, draw a flat line from that day to today so the
  // chart is immediately useful instead of showing the empty state for 24h.
  const sorted = rawSorted.length === 1
    ? (() => {
        const today = todayISO()
        if (rawSorted[0].date === today) {
          const yest = new Date(); yest.setDate(yest.getDate() - 1)
          return [{ ...rawSorted[0], date: localISO(yest) }, rawSorted[0]]
        }
        return [rawSorted[0], { ...rawSorted[0], date: today }]
      })()
    : rawSorted

  // Use LOCAL midnight timestamps so Chart.js's ticks (which work in local
  // time) and our data points line up at exactly the same x-position.
  const firstTs = isoToLocalTs(sorted[0].date)
  const lastTs = isoToLocalTs(sorted[sorted.length - 1].date)
  const spanDays = (lastTs - firstTs) / 86_400_000
  const unit = pickUnit(spanDays)

  const css = getComputedStyle(document.documentElement)
  const accent = css.getPropertyValue('--accent').trim() || '#fcd535'
  const gain = css.getPropertyValue('--gain').trim() || '#0ecb81'
  const gridColor = css.getPropertyValue('--chart-grid').trim() || 'rgba(43,49,57,0.6)'
  const cardBg = css.getPropertyValue('--card').trim() || '#1e2329'
  const borderColor = css.getPropertyValue('--border').trim() || '#2b3139'
  const textColor = css.getPropertyValue('--text').trim() || '#eaecef'
  const mutedColor = css.getPropertyValue('--text-muted').trim() || '#5e6673'

  const chartData = {
    datasets: [
      {
        label: 'Net Worth',
        data: sorted.map(s => ({ x: isoToLocalTs(s.date), y: s.netWorth })),
        borderColor: accent,
        backgroundColor: accent + '22',
        fill: true,
        cubicInterpolationMode: 'monotone',
        tension: 0,
        pointRadius: 0,
        pointHoverRadius: 5,
        pointBackgroundColor: accent,
        borderWidth: 2,
      },
      {
        label: 'Total Assets',
        data: sorted.map(s => ({ x: isoToLocalTs(s.date), y: s.totalAssets })),
        borderColor: gain,
        backgroundColor: 'transparent',
        fill: false,
        cubicInterpolationMode: 'monotone',
        tension: 0,
        pointRadius: 0,
        pointHoverRadius: 5,
        borderWidth: 1.5,
        borderDash: [4, 3],
      },
    ]
  }

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: cardBg,
        borderColor: borderColor,
        borderWidth: 1,
        titleColor: textColor,
        bodyColor: mutedColor,
        padding: 10,
        callbacks: {
          title: (items) => formatTooltipDate(items[0].parsed.x),
          label: (ctx) => ` ${ctx.dataset.label}: ${formatCurrency(ctx.parsed.y, baseCurrency, true)}`
        }
      }
    },
    scales: {
      x: {
        type: 'time',
        min: snapDown(firstTs, unit),
        max: lastTs,
        time: { unit, stepSize: 1 },
        grid: { color: gridColor, drawBorder: false },
        ticks: {
          color: mutedColor, font: { size: 11 },
          maxRotation: 0, autoSkip: true, autoSkipPadding: 16, source: 'auto',
          callback: (value) => formatTick(value, unit),
        },
        border: { display: false },
      },
      y: {
        grid: { color: gridColor, drawBorder: false },
        ticks: {
          color: mutedColor, font: { size: 11 },
          callback: (v) => formatCurrency(v, baseCurrency, true)
        },
        border: { display: false },
      }
    }
  }

  return (
    <div style={{ height }}>
      <Line key={theme} data={chartData} options={options} />
    </div>
  )
}
