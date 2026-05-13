import React, { useState, useMemo } from 'react'
import { Bar } from 'react-chartjs-2'
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, Tooltip, Legend
} from 'chart.js'
import { usePortfolio } from '../context/PortfolioContext.jsx'
import {
  formatCurrency, INCOME_TYPES, PASSIVE_INCOME_TYPES, getIncomeByMonth, getProjectedAnnualIncome
} from '../utils/calculations.js'
import { useTheme } from '../hooks/useTheme.js'
import CurrencyToggle from './CurrencyToggle.jsx'
import TransactionModal from './modals/TransactionModal.jsx'
import EarningsTimeframeChart from './charts/EarningsTimeframeChart.jsx'
import { getFxRate } from '../utils/calculations.js'

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend)

const TYPE_LABELS = {
  rental_income:  { label: 'Rental',    color: '#fcd535' },
  dividend:       { label: 'Dividends', color: '#0ecb81' },
  staking_reward: { label: 'Staking',   color: '#a855f7' },
  interest_income:{ label: 'Interest',  color: '#3b82f6' },
  salary:         { label: 'Salary',    color: '#f97316' },
}

export default function Income({ navContext = {} }) {
  const { data, totalIncome, pastYearPassiveIncome, deleteTransaction } = usePortfolio()
  const { theme } = useTheme()
  const [timeframe, setTimeframe] = useState('12') // '3' | '6' | '12' | '24'
  const [showIncomeModal, setShowIncomeModal] = useState(false)
  const [editingTxn, setEditingTxn] = useState(null)
  const [search, setSearch] = useState(navContext.filterSource || '')
  // Allow incoming navigation to pre-select an income type filter — the
  // Planning page uses this when a salary stream has no source recorded yet,
  // so the user lands on a list of just-salary entries instead of all income.
  const [filterType, setFilterType] = useState(navContext.filterType || 'all')
  const [confirmDelete, setConfirmDelete] = useState(null)
  const cur = data.settings.baseCurrency

  const byMonth = useMemo(() =>
    getIncomeByMonth(data.transactions, data.assets, data.fxCache, cur),
    [data.transactions, data.assets, data.fxCache, cur]
  )

  const projected = useMemo(() =>
    getProjectedAnnualIncome(data.transactions, data.assets, data.fxCache, cur),
    [data.transactions, data.assets, data.fxCache, cur]
  )

  const byType = useMemo(() => {
    const result = {}
    for (const t of data.transactions) {
      if (!INCOME_TYPES.includes(t.type)) continue
      const asset = data.assets.find(a => a.id === t.assetId)
      const currency = asset?.currency || 'USD'
      const amount = (parseFloat(t.totalValue) || parseFloat(t.price) || 0)
      const rate = getFxRate(currency, cur, data.fxCache)
      result[t.type] = (result[t.type] || 0) + amount * rate
    }
    return result
  }, [data.transactions, data.assets, data.fxCache, cur])

  const maxByType = Math.max(...Object.values(byType), 1)

  const numMonths = parseInt(timeframe)
  // Build a contiguous list of the last N months (anchored to today) so the
  // timeframe selector actually changes the bar width even when some months
  // have zero income. Previously this was Object.keys(byMonth).slice(-N) which
  // only ever showed months that contained income — making "12M" and "24M"
  // look identical for users who'd only logged income in 3 months.
  const sortedMonths = useMemo(() => {
    const out = []
    const now = new Date()
    for (let i = numMonths - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      out.push(ym)
    }
    return out
  }, [numMonths])

  // Build stacked bar chart data
  const monthlyChart = useMemo(() => {
    const labels = sortedMonths.map(month => {
      const [y, m] = month.split('-')
      return new Date(parseInt(y), parseInt(m) - 1, 1)
        .toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
    })
    const datasets = INCOME_TYPES.filter(type => {
      // only include types that show up in the selected window
      return sortedMonths.some(m => byMonth[m]?.byType?.[type] > 0)
    }).map(type => ({
      label: TYPE_LABELS[type]?.label || type,
      data: sortedMonths.map(m => byMonth[m]?.byType?.[type] || 0),
      backgroundColor: TYPE_LABELS[type]?.color || '#848e9c',
      borderRadius: 4,
      stack: 'income',
    }))
    return { labels, datasets }
  }, [sortedMonths, byMonth])

  const css = typeof document !== 'undefined' ? getComputedStyle(document.documentElement) : null
  const gridColor  = css?.getPropertyValue('--chart-grid').trim() || 'rgba(43,49,57,0.6)'
  const mutedColor = css?.getPropertyValue('--text-muted').trim() || '#5e6673'
  const cardBg     = css?.getPropertyValue('--card').trim() || '#1e2329'
  const borderCol  = css?.getPropertyValue('--border').trim() || '#2b3139'
  const textCol    = css?.getPropertyValue('--text').trim() || '#eaecef'

  const barOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { position: 'bottom', labels: { color: mutedColor, font: { size: 11 }, boxWidth: 12, boxHeight: 12 } },
      tooltip: {
        backgroundColor: cardBg, borderColor: borderCol, borderWidth: 1,
        titleColor: textCol, bodyColor: mutedColor, padding: 10,
        callbacks: {
          label: (ctx) => ` ${ctx.dataset.label}: ${formatCurrency(ctx.raw, cur, true)}`,
          footer: (items) => 'Total: ' + formatCurrency(items.reduce((s, i) => s + i.raw, 0), cur, true),
        }
      }
    },
    scales: {
      x: { stacked: true, grid: { display: false }, ticks: { color: mutedColor, font: { size: 11 } } },
      y: { stacked: true, grid: { color: gridColor }, ticks: { color: mutedColor, font: { size: 11 }, callback: v => formatCurrency(v, cur, true) } },
    }
  }

  // Income transactions sorted desc
  const allIncomeTxns = useMemo(() =>
    data.transactions
      .filter(t => INCOME_TYPES.includes(t.type))
      .map(t => ({ ...t, asset: data.assets.find(a => a.id === t.assetId) }))
      .sort((a, b) => b.date.localeCompare(a.date)),
    [data.transactions, data.assets]
  )

  // Series for timeframe chart — base-currency value of each income txn by date
  const incomeSeries = useMemo(() => allIncomeTxns
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(t => {
      const amt = parseFloat(t.totalValue) || parseFloat(t.price) || 0
      const fromCur = t.asset?.currency || 'USD'
      const rate = getFxRate(fromCur, cur, data.fxCache)
      return { date: t.date, value: amt * rate }
    }),
    [allIncomeTxns, data.fxCache, cur]
  )
  const q = search.trim().toLowerCase()
  const incomeTxns = allIncomeTxns.filter(t => {
    if (filterType !== 'all' && t.type !== filterType) return false
    if (!q) return true
    const hay = `${t.asset?.name || ''} ${t.notes || ''} ${t.type} ${t.source || ''}`.toLowerCase()
    return hay.includes(q)
  })

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Income</div>
          <div className="page-subtitle">Salary, dividends, rental, staking &amp; interest</div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <CurrencyToggle />
          <button className="btn btn-primary btn-sm" onClick={() => setShowIncomeModal(true)}>
            + Add Income
          </button>
        </div>
      </div>

      <div className="metrics-grid">
        <div className="metric-card">
          <div className="metric-label">Total Income</div>
          <div className="metric-value accent">{formatCurrency(totalIncome, cur, true)}</div>
          <div className="metric-sub">All time (incl. salary)</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Passive Income (Past Year)</div>
          <div className="metric-value accent">{formatCurrency(pastYearPassiveIncome, cur, true)}</div>
          <div className="metric-sub">Excludes salary</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Projected Annual</div>
          <div className="metric-value">{formatCurrency(projected, cur, true)}</div>
          <div className="metric-sub">Last 90 days × (365/90)</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Income Events</div>
          <div className="metric-value">{allIncomeTxns.length}</div>
          <div className="metric-sub">Total logged</div>
        </div>
      </div>

      <div style={{ marginBottom: 24 }}>
        <EarningsTimeframeChart
          series={incomeSeries}
          baseCurrency={cur}
          title="Cumulative Earnings"
          mode="cumulative"
          height={240}
        />
      </div>

      <div className="grid-2" style={{ marginBottom: 24 }}>
        <div className="card">
          <div className="card-header">
            <span className="card-title">By Income Type</span>
          </div>
          {Object.keys(byType).length === 0 ? (
            <div style={{ color: 'var(--text-muted)', fontSize: 13, textAlign: 'center', padding: '24px 0' }}>
              No income logged yet
            </div>
          ) : (
            <div style={{ paddingTop: 4 }}>
              {INCOME_TYPES.filter(t => byType[t] > 0).map(t => {
                const info = TYPE_LABELS[t]
                const pct = (byType[t] / maxByType) * 100
                return (
                  <div key={t} style={{ marginBottom: 12 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <span style={{ fontSize: 13 }}>{info.label}{PASSIVE_INCOME_TYPES.includes(t) ? '' : ' (active)'}</span>
                      <span style={{ fontWeight: 600, fontSize: 13 }}>{formatCurrency(byType[t], cur)}</span>
                    </div>
                    <div className="income-bar-track">
                      <div className="income-bar-fill" style={{ width: `${pct}%`, background: info.color }} />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <div className="card">
          <div className="card-header">
            <span className="card-title">Monthly Income</span>
            <div style={{ display: 'flex', gap: 6 }}>
              {['3', '6', '12', '24'].map(tf => (
                <button
                  key={tf}
                  className={`btn btn-xs ${timeframe === tf ? 'btn-primary' : 'btn-ghost'}`}
                  onClick={() => setTimeframe(tf)}
                >
                  {tf}M
                </button>
              ))}
            </div>
          </div>
          {monthlyChart.datasets.length === 0 ? (
            <div style={{ color: 'var(--text-muted)', fontSize: 13, textAlign: 'center', padding: '24px 0' }}>
              No income in the selected window
            </div>
          ) : (
            <div style={{ height: 260 }}>
              <Bar key={theme} data={monthlyChart} options={barOptions} />
            </div>
          )}
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <span className="card-title">Income Log</span>
        </div>
        <div className="filters-bar" style={{ marginBottom: 12 }}>
          <input
            type="search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="🔍 Search asset, notes…"
            style={{ width: 220 }}
          />
          <select value={filterType} onChange={e => setFilterType(e.target.value)} style={{ width: 'auto', minWidth: 160 }}>
            <option value="all">All income types</option>
            {INCOME_TYPES.map(t => (
              <option key={t} value={t}>{TYPE_LABELS[t]?.label || t}</option>
            ))}
          </select>
          {(search || filterType !== 'all') && (
            <button className="btn btn-ghost btn-sm" onClick={() => { setSearch(''); setFilterType('all') }}>
              ✕ Clear
            </button>
          )}
          <span style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 'auto' }}>
            {incomeTxns.length} shown
          </span>
        </div>
        {allIncomeTxns.length === 0 ? (
          <div className="empty-state" style={{ padding: '24px 0' }}>
            <p>Log dividends, salary, rental, staking, and interest via Transactions.</p>
          </div>
        ) : incomeTxns.length === 0 ? (
          <div className="empty-state" style={{ padding: '24px 0' }}>
            <p>No matches for the current filters.</p>
          </div>
        ) : (
          <div className="table-wrap" style={{ border: 'none' }}>
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Asset</th>
                  <th>Type</th>
                  <th>Source</th>
                  <th className="text-right">Amount</th>
                  <th>Notes</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {incomeTxns.map(t => {
                  const amount = parseFloat(t.totalValue) || parseFloat(t.price) || 0
                  const label = TYPE_LABELS[t.type]?.label || t.type
                  // Show explicit source if recorded; else fall back to the
                  // asset name for income types where the asset IS the source
                  // (dividend, rental, interest, staking).
                  const sourceDisplay = t.source ||
                    (t.type === 'salary' ? '—' : (t.asset?.name || '—'))
                  return (
                    <tr
                      key={t.id}
                      onClick={() => setEditingTxn(t)}
                      style={{ cursor: 'pointer' }}
                      title="Click to edit"
                    >
                      <td style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{t.date}</td>
                      <td style={{ fontWeight: 600 }}>{t.asset?.name || '—'}</td>
                      <td><span className={`badge badge-${t.type}`}>{label}</span></td>
                      <td style={{ fontSize: 12, color: t.source ? 'var(--text)' : 'var(--text-muted)' }}>
                        {sourceDisplay}
                      </td>
                      <td className="text-right fw-600 gain">
                        +{formatCurrency(amount, t.asset?.currency || 'USD')}
                      </td>
                      <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t.notes}</td>
                      <td onClick={e => e.stopPropagation()}>
                        <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                          <button className="btn btn-xs btn-ghost" title="Edit" onClick={() => setEditingTxn(t)}>✎</button>
                          <button className="btn btn-xs btn-danger" title="Delete" onClick={() => setConfirmDelete(t)}>✕</button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {editingTxn && (
        <TransactionModal
          transaction={editingTxn}
          onClose={() => setEditingTxn(null)}
        />
      )}

      {confirmDelete && (
        <div className="modal-backdrop">
          <div className="modal" style={{ maxWidth: 400 }}>
            <div className="modal-header">
              <span className="modal-title">Delete Income Entry</span>
              <button className="modal-close" onClick={() => setConfirmDelete(null)}>×</button>
            </div>
            <div className="modal-body">
              <p>Delete this {TYPE_LABELS[confirmDelete.type]?.label || confirmDelete.type} entry from {confirmDelete.date}?</p>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setConfirmDelete(null)}>Cancel</button>
              <button className="btn btn-danger" onClick={() => { deleteTransaction(confirmDelete.id); setConfirmDelete(null) }}>Delete</button>
            </div>
          </div>
        </div>
      )}

      {showIncomeModal && (
        <TransactionModal
          preselectedType="salary"
          onClose={() => setShowIncomeModal(false)}
        />
      )}
    </div>
  )
}
