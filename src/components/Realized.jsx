import React, { useMemo, useState } from 'react'
import { usePortfolio } from '../context/PortfolioContext.jsx'
import {
  formatCurrency, formatPct, ASSET_CLASSES, getRealizedPnLPerSale
} from '../utils/calculations.js'
import CurrencyToggle from './CurrencyToggle.jsx'

const CLASS_LABEL = Object.fromEntries(ASSET_CLASSES.map(c => [c.value, c.label]))

/**
 * Realized P&L breakdown — per-sale gains/losses, grouped by asset,
 * with filters. Linked from the Dashboard's "Realized P&L" metric card
 * and from the Holdings page.
 */
// Map the section we came from → a label for the "back" button so users get
// a clear, page-specific affordance ("← Markets", "← Property") rather than a
// generic "← Back". Falls back to Holdings as the most intuitive default.
const BACK_LABELS = {
  holdings: 'Holdings',
  stocks:   'Markets',
  property: 'Property',
  cash:     'Cash & Savings',
  dashboard: 'Dashboard',
}

export default function Realized({ onNavigate, navContext = {} }) {
  const { data } = usePortfolio()
  const cur = data.settings.baseCurrency

  // Initial class filter can be passed in from another page (e.g. Markets
  // links here pre-filtered to stocks+crypto). We accept either a single
  // class or 'markets' as a special multi-class shortcut.
  const initialClass = navContext.filterClass || 'all'
  const [filterClass, setFilterClass] = useState(initialClass)
  const [filterAsset, setFilterAsset] = useState('all')
  const [filterFrom, setFilterFrom] = useState('')
  const [filterTo, setFilterTo] = useState('')

  // Where to return when the user clicks the back button. Defaults to
  // Holdings (a much more useful destination than Dashboard for this page).
  const backTo = navContext.from || 'holdings'
  const backLabel = BACK_LABELS[backTo] || 'Holdings'

  const all = useMemo(
    () => getRealizedPnLPerSale(data.transactions, data.assets, data.fxCache, cur),
    [data.transactions, data.assets, data.fxCache, cur]
  )

  // 'markets' is a UI shortcut that means "stocks + crypto combined" — used
  // by the Markets page Realized P&L button. The dropdown still shows the
  // raw asset classes, so a user can drill down further once on this page.
  const filtered = useMemo(() => all.filter(r => {
    if (filterClass === 'markets') {
      if (r.assetClass !== 'stocks' && r.assetClass !== 'crypto') return false
    } else if (filterClass !== 'all' && r.assetClass !== filterClass) return false
    if (filterAsset !== 'all' && r.assetName !== filterAsset) return false
    if (filterFrom && r.date < filterFrom) return false
    if (filterTo && r.date > filterTo) return false
    return true
  }).sort((a, b) => b.date.localeCompare(a.date)),
  [all, filterClass, filterAsset, filterFrom, filterTo])

  const totalRealized = filtered.reduce((s, r) => s + (r.realizedBase || 0), 0)
  const wins = filtered.filter(r => r.realizedBase > 0)
  const losses = filtered.filter(r => r.realizedBase < 0)
  // Hit rate is wins / decisive sales (exclude breakeven). Otherwise 5W/5L/5BE
  // shows 33% instead of the more useful "50% on decisive trades".
  const decisive = wins.length + losses.length
  const hitRate = decisive > 0 ? (wins.length / decisive) * 100 : 0
  // Long-term (>1y) vs short-term split. Useful tax-planning awareness in
  // jurisdictions where LTCG is taxed lower than STCG (US, AU, UK, etc).
  const longTerm = filtered.filter(r => r.longTerm)
  const shortTerm = filtered.filter(r => r.daysHeld != null && !r.longTerm)
  const longTermPnL = longTerm.reduce((s, r) => s + (r.realizedBase || 0), 0)
  const shortTermPnL = shortTerm.reduce((s, r) => s + (r.realizedBase || 0), 0)

  // Per-asset rollup. Key on assetId (not name) so two assets with the same
  // name — e.g. two checking accounts both labelled "USD Cash" at different
  // banks — don't collapse into one row. Display name on the row.
  const byAsset = useMemo(() => {
    const m = {}
    for (const r of filtered) {
      const k = r.assetId || r.assetName
      if (!m[k]) m[k] = { id: r.assetId, name: r.assetName, class: r.assetClass, count: 0, total: 0 }
      m[k].count += 1
      m[k].total += r.realizedBase || 0
    }
    return Object.values(m).sort((a, b) => b.total - a.total)
  }, [filtered])

  const assetNames = [...new Set(all.map(r => r.assetName))].sort()

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Realized P&L Breakdown</div>
          <div className="page-subtitle">
            {filtered.length} realized sales ·{' '}
            {filterClass === 'markets' ? 'Markets (Stocks + Crypto)'
              : (CLASS_LABEL[filterClass] || 'All classes')}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <CurrencyToggle />
          <button className="btn btn-ghost btn-sm" onClick={() => onNavigate(backTo)}>← {backLabel}</button>
        </div>
      </div>

      {/* Summary metrics */}
      <div className="metrics-grid">
        <div className="metric-card">
          <div className="metric-label">Total Realized</div>
          <div className={`metric-value ${totalRealized >= 0 ? 'gain' : 'loss'}`}>
            {formatCurrency(totalRealized, cur, true)}
          </div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Winning Sales</div>
          <div className="metric-value gain">{wins.length}</div>
          <div className="metric-sub">
            {wins.length ? formatCurrency(wins.reduce((s, r) => s + r.realizedBase, 0), cur, true) : '—'}
          </div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Losing Sales</div>
          <div className="metric-value loss">{losses.length}</div>
          <div className="metric-sub">
            {losses.length ? formatCurrency(losses.reduce((s, r) => s + r.realizedBase, 0), cur, true) : '—'}
          </div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Hit Rate</div>
          <div className="metric-value">{hitRate.toFixed(0)}%</div>
          <div className="metric-sub">
            {wins.length}/{decisive} decisive
            {filtered.length - decisive > 0 && ` · ${filtered.length - decisive} breakeven`}
          </div>
        </div>
      </div>

      {/* Long-term vs short-term split — tax-aware view of realized gains */}
      {(longTerm.length > 0 || shortTerm.length > 0) && (
        <div className="card" style={{ marginBottom: 16, padding: 14 }}>
          <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase',
            letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: 10 }}>
            Holding-period split <span style={{ fontWeight: 400 }}>(LTCG threshold: 1 year — not tax advice)</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 14 }}>
            <div>
              <div className="metric-label">Long-term (≥1y)</div>
              <div className={`metric-value ${longTermPnL >= 0 ? 'gain' : 'loss'}`}>
                {formatCurrency(longTermPnL, cur, true)}
              </div>
              <div className="metric-sub">{longTerm.length} sale{longTerm.length === 1 ? '' : 's'}</div>
            </div>
            <div>
              <div className="metric-label">Short-term (&lt;1y)</div>
              <div className={`metric-value ${shortTermPnL >= 0 ? 'gain' : 'loss'}`}>
                {formatCurrency(shortTermPnL, cur, true)}
              </div>
              <div className="metric-sub">{shortTerm.length} sale{shortTerm.length === 1 ? '' : 's'}</div>
            </div>
            {(longTerm.length > 0 || shortTerm.length > 0) && (
              <div>
                <div className="metric-label">Long-term Share</div>
                <div className="metric-value">
                  {(() => {
                    // Share of total activity by absolute magnitude so the
                    // metric is meaningful even when one side is a net loss
                    // (the prior version only counted positive PnL, which
                    // showed 0% / — for any all-loss period). Falls back to
                    // count-based share when both sides happen to be zero.
                    const absLT = Math.abs(longTermPnL)
                    const absST = Math.abs(shortTermPnL)
                    const denom = absLT + absST
                    if (denom > 0) return `${((absLT / denom) * 100).toFixed(0)}%`
                    const cntDenom = longTerm.length + shortTerm.length
                    return cntDenom > 0 ? `${((longTerm.length / cntDenom) * 100).toFixed(0)}%` : '—'
                  })()}
                </div>
                <div className="metric-sub">By magnitude of realized P&L · higher = potentially more tax-efficient</div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="filters-bar">
        <select value={filterClass} onChange={e => setFilterClass(e.target.value)}>
          <option value="all">All Classes</option>
          <option value="markets">📊 Markets (Stocks + Crypto)</option>
          {ASSET_CLASSES.map(c => <option key={c.value} value={c.value}>{c.icon} {c.label}</option>)}
        </select>
        <select value={filterAsset} onChange={e => setFilterAsset(e.target.value)}>
          <option value="all">All Assets</option>
          {assetNames.map(n => <option key={n} value={n}>{n}</option>)}
        </select>
        <input type="date" value={filterFrom} onChange={e => setFilterFrom(e.target.value)} style={{ width: 140 }} title="From date" />
        <input type="date" value={filterTo} onChange={e => setFilterTo(e.target.value)} style={{ width: 140 }} title="To date" />
        {(filterClass !== 'all' || filterAsset !== 'all' || filterFrom || filterTo) && (
          <button className="btn btn-ghost btn-sm" onClick={() => {
            setFilterClass('all'); setFilterAsset('all'); setFilterFrom(''); setFilterTo('')
          }}>✕ Clear</button>
        )}
      </div>

      {filtered.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <div className="empty-state-icon">💱</div>
            <h3>No realized P&L yet</h3>
            <p>Sales and withdrawals will appear here with per-transaction gain/loss.</p>
          </div>
        </div>
      ) : (
        <>
          {/* Per-asset rollup */}
          <div className="card" style={{ marginBottom: 20 }}>
            <div className="card-header"><span className="card-title">By Asset</span></div>
            <div className="table-wrap" style={{ border: 'none' }}>
              <table>
                <thead>
                  <tr>
                    <th>Asset</th>
                    <th>Class</th>
                    <th className="text-right"># Sales</th>
                    <th className="text-right">Realized P&L ({cur})</th>
                  </tr>
                </thead>
                <tbody>
                  {byAsset.map(a => (
                    <tr key={a.id || a.name}>
                      <td style={{ fontWeight: 600 }}>{a.name}</td>
                      <td><span className={`badge badge-${a.class}`}>{CLASS_LABEL[a.class] || a.class}</span></td>
                      <td className="text-right muted">{a.count}</td>
                      <td className={`text-right fw-600 ${a.total >= 0 ? 'gain' : 'loss'}`}>
                        {formatCurrency(a.total, cur)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Per-sale log */}
          <div className="card">
            <div className="card-header"><span className="card-title">Sale Log</span></div>
            <div className="table-wrap" style={{ border: 'none' }}>
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Asset</th>
                    <th>Class</th>
                    <th>Held</th>
                    <th className="text-right">Qty</th>
                    <th className="text-right">Sell Price</th>
                    <th className="text-right">Avg Cost</th>
                    <th className="text-right">Realized</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(r => {
                    const pct = r.avgCost > 0 ? ((r.sellPrice - r.avgCost) / r.avgCost) * 100 : 0
                    const heldLabel = r.daysHeld == null ? '—'
                      : r.daysHeld < 30 ? `${r.daysHeld}d`
                      : r.daysHeld < 365 ? `${Math.floor(r.daysHeld / 30)}mo`
                      : `${(r.daysHeld / 365).toFixed(1)}y`
                    return (
                      <tr key={r.txnId}>
                        <td style={{ whiteSpace: 'nowrap', color: 'var(--text-muted)' }}>{r.date}</td>
                        <td style={{ fontWeight: 600 }}>{r.assetName}</td>
                        <td><span className={`badge badge-${r.assetClass}`}>{CLASS_LABEL[r.assetClass] || r.assetClass}</span></td>
                        <td>
                          <span
                            title={r.longTerm
                              ? 'Held > 1 year — typically qualifies for long-term capital gains tax treatment in many jurisdictions. Not tax advice.'
                              : `Held ${r.daysHeld ?? '?'} days — short-term`}
                            style={{
                              fontSize: 10, padding: '2px 6px', borderRadius: 3,
                              background: r.longTerm ? 'rgba(14, 203, 129, 0.15)' : 'var(--bg-secondary)',
                              color: r.longTerm ? 'var(--gain)' : 'var(--text-muted)',
                              fontWeight: 600,
                            }}
                          >
                            {heldLabel}{r.longTerm ? ' · LT' : ''}
                          </span>
                        </td>
                        <td className="text-right muted">{r.qty.toLocaleString('en-US', { maximumFractionDigits: 4 })}</td>
                        <td className="text-right muted">{formatCurrency(r.sellPrice, r.currency)}</td>
                        <td className="text-right muted">{formatCurrency(r.avgCost, r.currency)}</td>
                        <td className={`text-right fw-600 ${r.realizedBase >= 0 ? 'gain' : 'loss'}`}>
                          {formatCurrency(r.realizedBase, cur)}
                          <span style={{ fontSize: 11, marginLeft: 4 }}>({formatPct(pct)})</span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
