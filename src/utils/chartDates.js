// Single source of truth for converting calendar dates to chart timestamps.
// We use LOCAL midnight (not UTC midnight) so that:
//   1. Chart.js's default tick generator (which works in local time) places
//      ticks at the same instants as our data points.
//   2. Both ticks and tooltips can format in the user's local timezone and
//      get back the EXACT calendar date the data was tagged with.
//
// Using UTC midnight broke this: a "2026-03-01" stamp meant 2026-03-01 00:00
// UTC, which is 2026-03-01 07:00 in Jakarta. Chart.js's tick at LOCAL Mar 1
// midnight (= 2026-02-28 17:00 UTC) was a separate position, so the data
// point appeared offset from the tick.

// "YYYY-MM-DD" → ms timestamp at LOCAL midnight on that calendar date.
// Returns NaN for unparseable input so callers can branch / filter — Chart.js
// silently drops NaN-x points instead of crashing.
export function isoToLocalTs(iso) {
  if (!iso || typeof iso !== 'string') return NaN
  const [y, m, d] = iso.split('-').map(Number)
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return NaN
  const ts = new Date(y, m - 1, d).getTime()
  return Number.isFinite(ts) ? ts : NaN
}

// Format a chart timestamp (= local midnight) for axis ticks. Local tz so
// what we display matches what we stored.
export function formatTick(ts, unit) {
  if (!Number.isFinite(ts)) return ''
  const d = new Date(ts)
  if (unit === 'year')  return d.toLocaleDateString('en-US', { year: 'numeric' })
  if (unit === 'month') return d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// Format a chart timestamp for tooltips. Always shows full date.
export function formatTooltipDate(ts) {
  if (!Number.isFinite(ts)) return ''
  return new Date(ts).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  })
}
