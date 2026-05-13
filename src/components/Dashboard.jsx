import React, { useState, useMemo } from 'react'
import { usePortfolio } from '../context/PortfolioContext.jsx'
import AllocationChart from './charts/AllocationChart.jsx'
import NetWorthChart from './charts/NetWorthChart.jsx'
import ExplainMetric from './ExplainMetric.jsx'
import { formatCurrency, formatPct, ASSET_CLASSES, fireProjection, getFxRate, localISO } from '../utils/calculations.js'
import { buildNetWorthSeries, makeDaily, makeMonthly, makeYearly } from '../utils/netWorthSeries.js'

const CLASS_LABEL = Object.fromEntries(ASSET_CLASSES.map(c => [c.value, c.label]))
import TransactionModal from './modals/TransactionModal.jsx'
import AssetModal from './modals/AssetModal.jsx'
import CurrencyToggle from './CurrencyToggle.jsx'

export default function Dashboard({ onNavigate }) {
  const {
    data, holdings, netWorthStats, allocationByClass,
    totalIncome, pastYearPassiveIncome, totalUnrealizedPnL, totalRealizedPnL,
    priceLoading, refreshPrices
  } = usePortfolio()

  const [showTxnModal, setShowTxnModal] = useState(false)
  const [showAssetModal, setShowAssetModal] = useState(false)
  const [dashTimeframe, setDashTimeframe] = useState('all')

  const { totalAssetsBase, totalLiabilitiesBase, netWorthBase } = netWorthStats
  const cur = data.settings.baseCurrency

  // Build the same densely-reconstructed series the Net Worth History page uses,
  // then slice/downsample for the selected timeframe so 30D / 12W / 12M / 5Y / All
  // never collapse onto the same handful of saved snapshots.
  const fullSeries = useMemo(() =>
    buildNetWorthSeries(data, cur, { totalAssetsBase, totalLiabilitiesBase, netWorthBase }),
    [data, cur, totalAssetsBase, totalLiabilitiesBase, netWorthBase]
  )
  const filteredSnapshots = useMemo(() => {
    if (!fullSeries.length) return []
    if (dashTimeframe === 'daily')   return makeDaily(fullSeries, 30)
    // 3M view: sample DAILY across 90 days, not weekly across 12. Weekly
    // sampling could only place anchors on Mondays — so a mid-week
    // transaction (e.g. a Wednesday buy) compressed all its impact into the
    // gap between the prior and following Monday, producing a near-vertical
    // hockey-stick. Daily sampling places the jump on the day it actually
    // happened.
    if (dashTimeframe === 'weekly')  return makeDaily(fullSeries, 90)
    if (dashTimeframe === 'monthly') return makeMonthly(fullSeries, 12)
    if (dashTimeframe === 'yearly')  return makeYearly(fullSeries, 5)
    if (dashTimeframe === 'all') {
      const first = new Date(fullSeries[0].date + 'T00:00:00Z')
      const now = new Date()
      const months = (now.getUTCFullYear() - first.getUTCFullYear()) * 12 + (now.getUTCMonth() - first.getUTCMonth()) + 1
      return makeMonthly(fullSeries, Math.max(2, months))
    }
    return fullSeries
  }, [fullSeries, dashTimeframe])

  const topHoldings = [...holdings]
    .sort((a, b) => (b.currentValueBase || 0) - (a.currentValueBase || 0))
    .slice(0, 5)

  // YoY = today vs ~12 months ago, using the reconstructed series so it works
  // even when the user has no snapshot exactly from January last year.
  // Use localISO instead of toISOString so users far from UTC don't get the
  // target date shifted by a day at month/year boundaries.
  const yoyChange = useMemo(() => {
    if (!fullSeries.length) return null
    const today = new Date()
    const target = new Date(today.getFullYear() - 1, today.getMonth(), today.getDate())
    const targetISO = localISO(target)
    // Latest series point on/before target date
    let snap = null
    for (const p of fullSeries) {
      if (p.date > targetISO) break
      snap = p
    }
    if (!snap) return null
    return netWorthBase - snap.netWorth
  }, [fullSeries, netWorthBase])

  // ── Considerate planning metrics ────────────────────────────────────────
  // Liquid assets = cash & savings only. We exclude investments because
  // selling stocks to cover an emergency typically takes days and can
  // realize losses — emergency fund math should reflect "what's actually
  // accessible right now."
  const liquidBase = useMemo(
    () => holdings.filter(h => h.class === 'cash').reduce((s, h) => s + (h.currentValueBase || 0), 0),
    [holdings]
  )

  // Monthly recurring expense burn in base currency. Pull from data.expenses
  // and normalize weekly (×52/12) and yearly (÷12) to a monthly figure. This
  // is the user's structural burn — not one-off splurges — so the runway
  // estimate is a worst-case floor of how long the cash holds out.
  const monthlyBurnBase = useMemo(() => {
    const WEEKS_PER_MONTH = 52 / 12
    const exps = data.expenses || []
    return exps.reduce((s, e) => {
      const amt = parseFloat(e.amount) || 0
      const rate = getFxRate(e.currency || cur, cur, data.fxCache || {})
      const baseAmt = amt * rate
      if (e.recurrence === 'weekly')  return s + baseAmt * WEEKS_PER_MONTH
      if (e.recurrence === 'monthly') return s + baseAmt
      if (e.recurrence === 'yearly')  return s + baseAmt / 12
      return s // one-time expenses excluded from "structural burn"
    }, 0)
  }, [data.expenses, data.fxCache, cur])

  // Average monthly take-home over the last 90 days — salary + passive.
  // Used as input to FIRE math and to show net cashflow.
  const monthlyIncomeBase = useMemo(() => {
    const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 90)
    const cutoffISO = cutoff.toISOString().slice(0, 10)
    let total = 0
    for (const t of data.transactions) {
      if (!['salary', 'rental_income', 'dividend', 'staking_reward', 'interest_income'].includes(t.type)) continue
      if (t.date < cutoffISO) continue
      const asset = data.assets.find(a => a.id === t.assetId)
      const fromCcy = asset?.currency || 'USD'
      const amt = parseFloat(t.totalValue) || parseFloat(t.price) || 0
      total += amt * getFxRate(fromCcy, cur, data.fxCache || {})
    }
    return total / 3 // 90 days ≈ 3 months
  }, [data.transactions, data.assets, data.fxCache, cur])

  const monthsCovered = monthlyBurnBase > 0 ? liquidBase / monthlyBurnBase : null
  const monthlyNetSavings = monthlyIncomeBase - monthlyBurnBase

  // FIRE: 25× annual expenses → financial independence
  const fireResult = useMemo(() => {
    if (monthlyBurnBase <= 0) return null
    return fireProjection(netWorthBase, monthlyNetSavings, monthlyBurnBase * 12)
  }, [netWorthBase, monthlyNetSavings, monthlyBurnBase])

  // Concentration: largest single holding as % of total assets.
  // High concentration (>30%) = single-point-of-failure risk.
  const concentration = useMemo(() => {
    if (!holdings.length || totalAssetsBase <= 0) return null
    const top = [...holdings].sort((a, b) => (b.currentValueBase || 0) - (a.currentValueBase || 0))[0]
    const topPct = ((top.currentValueBase || 0) / totalAssetsBase) * 100
    const top3 = [...holdings]
      .sort((a, b) => (b.currentValueBase || 0) - (a.currentValueBase || 0))
      .slice(0, 3)
      .reduce((s, h) => s + (h.currentValueBase || 0), 0)
    const top3Pct = (top3 / totalAssetsBase) * 100
    return { top, topPct, top3Pct }
  }, [holdings, totalAssetsBase])

  // Currency exposure breakdown — net worth by underlying currency.
  // Helps users understand FX risk: a 10% USD drawdown when 70% of net
  // worth is USD-denominated is a 7% net worth drawdown.
  const currencyExposure = useMemo(() => {
    const map = {}
    for (const h of holdings) {
      const ccy = h.currency || 'USD'
      map[ccy] = (map[ccy] || 0) + (h.currentValueBase || 0)
    }
    const total = Object.values(map).reduce((s, v) => s + v, 0)
    return Object.entries(map)
      .filter(([, v]) => v > 0)
      .map(([ccy, val]) => ({ ccy, val, pct: total > 0 ? (val / total) * 100 : 0 }))
      .sort((a, b) => b.val - a.val)
  }, [holdings])

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Dashboard</div>
          <div className="page-subtitle">
            {new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <CurrencyToggle />
          {data.assets.length > 0 && (
            <button className="btn btn-secondary btn-sm" onClick={() => setShowTxnModal(true)}>
              + Transaction
            </button>
          )}
          <button className="btn btn-secondary btn-sm" onClick={() => setShowAssetModal(true)}>
            + Asset
          </button>
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => refreshPrices({ force: true })}
            disabled={priceLoading}
          >
            {priceLoading ? <span className="spinner" style={{ width: 12, height: 12 }} /> : '↻'} Refresh Prices
          </button>
        </div>
      </div>

      {/* Metrics — each card clickable, navigates to its breakdown page */}
      <div className="metrics-grid">
        <div className="metric-card clickable" onClick={() => onNavigate('history')} title="View net worth history">
          <div className="metric-label">Net Worth</div>
          <div className={`metric-value ${netWorthBase >= 0 ? '' : 'loss'}`}>
            {formatCurrency(netWorthBase, cur, true)}
          </div>
          {yoyChange !== null && (
            <div className={`metric-sub ${yoyChange >= 0 ? 'gain' : 'loss'}`}>
              {yoyChange >= 0 ? '▲' : '▼'} {formatCurrency(Math.abs(yoyChange), cur, true)} YoY
            </div>
          )}
        </div>
        <div className="metric-card clickable" onClick={() => onNavigate('holdings')} title="View all holdings">
          <div className="metric-label">Total Assets</div>
          <div className="metric-value">{formatCurrency(totalAssetsBase, cur, true)}</div>
          <div className="metric-sub">{holdings.length} positions</div>
        </div>
        <div className="metric-card clickable" onClick={() => onNavigate('liabilities')} title="View liabilities">
          <div className="metric-label">Total Liabilities</div>
          <div className={`metric-value ${totalLiabilitiesBase > 0 ? 'loss' : ''}`}>
            {formatCurrency(totalLiabilitiesBase, cur, true)}
          </div>
          <div className="metric-sub">{data.liabilities.length} items</div>
        </div>
        <div className="metric-card clickable" onClick={() => onNavigate('holdings')} title="View holdings">
          <div className="metric-label">Unrealized P&L</div>
          <div className={`metric-value ${totalUnrealizedPnL >= 0 ? 'gain' : 'loss'}`}>
            {formatCurrency(totalUnrealizedPnL, cur, true)}
          </div>
        </div>
        <div className="metric-card clickable" onClick={() => onNavigate('realized')} title="Realized P&L breakdown">
          <div className="metric-label">Realized P&L</div>
          <div className={`metric-value ${totalRealizedPnL >= 0 ? 'gain' : 'loss'}`}>
            {formatCurrency(totalRealizedPnL, cur, true)}
          </div>
          <div className="metric-sub">Click for breakdown →</div>
        </div>
        <div className="metric-card clickable" onClick={() => onNavigate('income')} title="View income details">
          <div className="metric-label">Total Income</div>
          <div className="metric-value accent">{formatCurrency(totalIncome, cur, true)}</div>
          <div className="metric-sub">All time (incl. salary)</div>
        </div>
        <div className="metric-card clickable" onClick={() => onNavigate('income')} title="View passive income">
          <div className="metric-label">Passive Income (1Y)</div>
          <div className="metric-value accent">{formatCurrency(pastYearPassiveIncome, cur, true)}</div>
          <div className="metric-sub">Dividends, rent, interest, staking</div>
        </div>
      </div>

      {/* Considerate planning metrics — only render when meaningful inputs exist */}
      {(monthsCovered !== null || fireResult || concentration || currencyExposure.length > 1) && (
        <div className="card" style={{ marginBottom: 24 }}>
          <div className="card-header">
            <span className="card-title">Financial Health</span>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              💡 Click any metric to see how it's calculated
            </span>
          </div>
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14,
          }}>
            {monthsCovered !== null && (
              <ExplainMetric
                label="Emergency Fund"
                value={monthsCovered >= 100 ? '∞' : `${monthsCovered.toFixed(1)} mo`}
                valueClass={monthsCovered >= 6 ? 'gain' : monthsCovered >= 3 ? '' : 'loss'}
                sub={monthsCovered >= 6 ? '✓ Healthy (6+ months)' :
                     monthsCovered >= 3 ? 'Building (3–6 months)' :
                     'Below target — aim for 3+ months'}
                explanation={
                  <>
                    <strong>How many months your liquid cash &amp; savings would cover your recurring expenses</strong> if all
                    income stopped today. We exclude investments because selling stocks in an
                    emergency takes days and may force you to realize losses — only what's
                    truly accessible counts. Standard guidance is to keep 3–6 months saved.
                  </>
                }
                formula="Liquid cash & savings ÷ Monthly recurring expenses"
                inputs={[
                  { label: 'Liquid cash & savings', value: formatCurrency(liquidBase, cur, true) },
                  { label: 'Monthly recurring expenses', value: formatCurrency(monthlyBurnBase, cur, true) },
                  { label: '= Months covered', value: monthsCovered >= 100 ? '∞' : `${monthsCovered.toFixed(2)} mo` },
                ]}
                interpretation={[
                  { band: '< 3 mo',  label: 'Below target — build a safety buffer first', cls: 'loss',  active: monthsCovered < 3 },
                  { band: '3–6 mo',  label: 'Building — solid foundation, keep growing',  cls: '',      active: monthsCovered >= 3 && monthsCovered < 6 },
                  { band: '6–12 mo', label: 'Healthy — most planners recommend this',     cls: 'gain',  active: monthsCovered >= 6 && monthsCovered < 12 },
                  { band: '> 12 mo', label: 'Excessive — consider investing the surplus', cls: 'accent', active: monthsCovered >= 12 },
                ]}
              />
            )}
            {monthlyNetSavings !== 0 && monthlyBurnBase > 0 && (
              <ExplainMetric
                label="Monthly Net Cashflow"
                value={`${monthlyNetSavings >= 0 ? '+' : ''}${formatCurrency(monthlyNetSavings, cur, true)}`}
                valueClass={monthlyNetSavings >= 0 ? 'gain' : 'loss'}
                sub={monthlyNetSavings >= 0 && monthlyIncomeBase > 0
                  ? `${((monthlyNetSavings / monthlyIncomeBase) * 100).toFixed(0)}% savings rate`
                  : monthlyNetSavings >= 0
                    ? 'No income logged in the last 90 days'
                    : 'Spending exceeds income (90d avg)'}
                explanation={
                  <>
                    <strong>How much money you have left over each month after expenses,</strong> averaged over the
                    last 90 days. Income includes salary, dividends, rental, interest, and
                    staking. Expenses are your recurring monthly burn (yearly expenses are
                    divided by 12). A negative number means you're drawing down savings.
                  </>
                }
                formula="(Income last 90 days ÷ 3 months) − Monthly recurring expenses"
                inputs={[
                  { label: 'Avg monthly income (90d)', value: formatCurrency(monthlyIncomeBase, cur, true) },
                  { label: 'Monthly recurring expenses', value: formatCurrency(monthlyBurnBase, cur, true) },
                  { label: '= Net cashflow', value: `${monthlyNetSavings >= 0 ? '+' : ''}${formatCurrency(monthlyNetSavings, cur, true)}` },
                  ...(monthlyIncomeBase > 0 ? [{ label: 'Savings rate', value: `${((monthlyNetSavings / monthlyIncomeBase) * 100).toFixed(1)}%` }] : []),
                ]}
                interpretation={[
                  { band: 'Negative', label: 'Spending more than earning — patch the leak', cls: 'loss',  active: monthlyNetSavings < 0 },
                  { band: '0–10%',    label: 'Saving a bit — try to push toward 20%',        cls: '',      active: monthlyIncomeBase > 0 && monthlyNetSavings / monthlyIncomeBase >= 0 && monthlyNetSavings / monthlyIncomeBase < 0.10 },
                  { band: '10–20%',   label: 'Solid savings rate',                            cls: 'gain',  active: monthlyIncomeBase > 0 && monthlyNetSavings / monthlyIncomeBase >= 0.10 && monthlyNetSavings / monthlyIncomeBase < 0.20 },
                  { band: '> 20%',    label: 'Excellent — accelerates FI dramatically',       cls: 'accent', active: monthlyIncomeBase > 0 && monthlyNetSavings / monthlyIncomeBase >= 0.20 },
                ]}
              />
            )}
            {fireResult && monthlyBurnBase > 0 && (
              <ExplainMetric
                label="Years to FI"
                value={fireResult.reached ? '✓ Reached' :
                  isFinite(fireResult.years) ? `${fireResult.years.toFixed(1)} yrs` : '—'}
                valueClass={fireResult.reached ? 'gain' : isFinite(fireResult.years) ? '' : 'loss'}
                sub={`Target: ${formatCurrency(fireResult.target, cur, true)}${
                  !fireResult.reached && isFinite(fireResult.years) ? ` · age-equiv +${Math.round(fireResult.years)}y` : ''
                }`}
                explanation={
                  <>
                    <strong>Years until your net worth reaches 25× your annual expenses</strong> — the
                    "Trinity Study" 4% safe-withdrawal rule. Once you hit this number, a
                    portfolio of mostly stocks &amp; bonds can sustain your current spending
                    indefinitely with high probability. Assumes a 5% real (inflation-adjusted)
                    return on invested assets.
                  </>
                }
                formula="Solve: NetWorth × (1+r)ⁿ + Savings × ((1+r)ⁿ − 1)/r = 25 × annual expenses"
                inputs={[
                  { label: 'Current net worth', value: formatCurrency(netWorthBase, cur, true) },
                  { label: 'Annual expenses', value: formatCurrency(monthlyBurnBase * 12, cur, true) },
                  { label: 'Target (25×)', value: formatCurrency(fireResult.target, cur, true) },
                  { label: 'Monthly net savings', value: formatCurrency(monthlyNetSavings, cur, true) },
                  { label: 'Assumed real return', value: '5% / yr' },
                  { label: '= Years to target', value: fireResult.reached ? '0 (reached!)' :
                    isFinite(fireResult.years) ? `${fireResult.years.toFixed(2)} yrs` : 'Need positive savings' },
                ]}
                interpretation={[
                  { band: 'Reached', label: 'You can stop working — congrats!',     cls: 'gain', active: fireResult.reached },
                  { band: '< 10 yr', label: 'Close — minor tweaks accelerate this', cls: 'gain', active: !fireResult.reached && isFinite(fireResult.years) && fireResult.years < 10 },
                  { band: '10–20 yr', label: 'On track — common range',             cls: '',     active: !fireResult.reached && isFinite(fireResult.years) && fireResult.years >= 10 && fireResult.years < 20 },
                  { band: '20–30 yr', label: 'Long horizon — increase savings rate', cls: '',    active: !fireResult.reached && isFinite(fireResult.years) && fireResult.years >= 20 && fireResult.years < 30 },
                  { band: '> 30 yr',  label: 'Very long — review savings rate',     cls: 'loss', active: !fireResult.reached && isFinite(fireResult.years) && fireResult.years >= 30 },
                  { band: 'Never',    label: "Spending exceeds saving — can't get there", cls: 'loss', active: !isFinite(fireResult.years) },
                ]}
              />
            )}
            {concentration && concentration.topPct > 5 && (
              <ExplainMetric
                label="Concentration"
                value={`${concentration.topPct.toFixed(0)}%`}
                valueClass={concentration.topPct > 30 ? 'loss' : concentration.topPct > 20 ? 'accent' : ''}
                sub={`${concentration.top.name}${concentration.topPct > 30 ? ' · consider diversifying' : ''}`}
                explanation={
                  <>
                    <strong>How much of your total assets are tied up in your single largest holding.</strong> High
                    concentration amplifies single-asset risk: if that one position drops 50%,
                    so does that share of your net worth. Most advisors suggest keeping any
                    single position below 20–25% of your portfolio.
                  </>
                }
                formula="Largest holding value ÷ Total assets"
                inputs={[
                  { label: 'Largest holding', value: concentration.top.name },
                  { label: '  Value', value: formatCurrency(concentration.top.currentValueBase || 0, cur, true) },
                  { label: 'Total assets', value: formatCurrency(totalAssetsBase, cur, true) },
                  { label: '= Top-1 concentration', value: `${concentration.topPct.toFixed(1)}%` },
                  { label: 'Top-3 concentration', value: `${concentration.top3Pct.toFixed(1)}%` },
                ]}
                interpretation={[
                  { band: '< 10%',  label: 'Well diversified',                              cls: 'gain',   active: concentration.topPct < 10 },
                  { band: '10–20%', label: 'Reasonable for a conviction position',         cls: '',       active: concentration.topPct >= 10 && concentration.topPct < 20 },
                  { band: '20–30%', label: 'Watch — single-asset risk is meaningful',      cls: 'accent', active: concentration.topPct >= 20 && concentration.topPct < 30 },
                  { band: '> 30%',  label: 'High — consider trimming or hedging',          cls: 'loss',   active: concentration.topPct >= 30 },
                ]}
              />
            )}
          </div>

          {/* Currency exposure breakdown */}
          {currencyExposure.length > 1 && (
            <div style={{ marginTop: 18, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
              <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase',
                letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: 8 }}>
                Currency Exposure
              </div>
              <div style={{ display: 'flex', height: 8, borderRadius: 4, overflow: 'hidden' }}>
                {currencyExposure.map((c, i) => (
                  <div
                    key={c.ccy}
                    title={`${c.ccy} · ${c.pct.toFixed(1)}% · ${formatCurrency(c.val, cur, true)}`}
                    style={{
                      width: `${c.pct}%`,
                      background: ['#3b82f6', '#0ecb81', '#f97316', '#a855f7', '#eab308', '#ec4899', '#14b8a6', '#f43f5e'][i % 8],
                    }}
                  />
                ))}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 8, fontSize: 11 }}>
                {currencyExposure.map((c, i) => (
                  <span key={c.ccy} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span style={{
                      width: 8, height: 8, borderRadius: '50%',
                      background: ['#3b82f6', '#0ecb81', '#f97316', '#a855f7', '#eab308', '#ec4899', '#14b8a6', '#f43f5e'][i % 8],
                    }} />
                    <strong>{c.ccy}</strong>
                    <span style={{ color: 'var(--text-muted)' }}>{c.pct.toFixed(1)}%</span>
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Charts row */}
      <div className="grid-2" style={{ marginBottom: 24 }}>
        <div className="card">
          <div className="card-header">
            <span className="card-title">Allocation by Class</span>
          </div>
          <AllocationChart allocationByClass={allocationByClass} baseCurrency={cur} />
        </div>
        <div className="card">
          <div className="card-header" style={{ flexWrap: 'wrap', gap: 8 }}>
            <span
              className="card-title"
              onClick={() => onNavigate('history')}
              style={{ cursor: 'pointer', textDecoration: 'underline', textDecorationColor: 'transparent', transition: 'text-decoration-color 0.2s' }}
              onMouseEnter={e => e.currentTarget.style.textDecorationColor = 'var(--accent)'}
              onMouseLeave={e => e.currentTarget.style.textDecorationColor = 'transparent'}
              title="Click to view full history"
            >
              Net Worth History →
            </span>
            <div style={{ display: 'flex', gap: 4 }}>
              {['daily', 'weekly', 'monthly', 'yearly', 'all'].map(tf => (
                <button
                  key={tf}
                  className={`btn btn-xs ${dashTimeframe === tf ? 'btn-primary' : 'btn-ghost'}`}
                  onClick={() => setDashTimeframe(tf)}
                  style={{ minWidth: 44 }}
                >
                  {tf === 'daily' ? '30D' : tf === 'weekly' ? '3M' : tf === 'monthly' ? '12M' : tf === 'yearly' ? '5Y' : 'All'}
                </button>
              ))}
            </div>
          </div>
          <NetWorthChart snapshots={filteredSnapshots} baseCurrency={cur} height={200} />
        </div>
      </div>

      {/* Top Holdings */}
      {topHoldings.length > 0 && (
        <div className="card">
          <div className="card-header">
            <span className="card-title">Top Holdings</span>
            <button className="btn btn-ghost btn-sm" onClick={() => onNavigate('holdings')}>View all →</button>
          </div>
          <div className="table-wrap" style={{ border: 'none' }}>
            <table>
              <thead>
                <tr>
                  <th>Asset</th>
                  <th>Class</th>
                  <th className="text-right">Value ({cur})</th>
                  <th className="text-right">Allocation</th>
                  <th className="text-right">Unrealized P&L</th>
                </tr>
              </thead>
              <tbody>
                {topHoldings.map(h => {
                  const pct = totalAssetsBase > 0 ? (h.currentValueBase / totalAssetsBase) * 100 : 0
                  // Navigate to asset's respective page if one exists,
                  // otherwise fall back to the general Holdings page.
                  const handleRowClick = () => {
                    if (h.class === 'property') onNavigate('property')
                    else if (h.class === 'stocks' || h.class === 'crypto') onNavigate('stocks')
                    else if (h.class === 'cash') onNavigate('cash')
                    else onNavigate('holdings')
                  }
                  return (
                    <tr key={h.id} onClick={handleRowClick} style={{ cursor: 'pointer' }} title="Click to view details">
                      <td>
                        <div style={{ fontWeight: 600 }}>{h.name}</div>
                        {h.symbol && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{h.symbol}</div>}
                      </td>
                      <td><span className={`badge badge-${h.class}`}>{CLASS_LABEL[h.class] || h.class}</span></td>
                      <td className="text-right fw-600">{formatCurrency(h.currentValueBase, cur)}</td>
                      <td className="text-right muted">{pct.toFixed(1)}%</td>
                      <td className={`text-right fw-600 ${h.unrealizedPnLBase >= 0 ? 'gain' : 'loss'}`}>
                        {formatCurrency(h.unrealizedPnLBase, cur)}
                        {' '}
                        <span style={{ fontSize: 11 }}>({formatPct(h.unrealizedPnLPct)})</span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {holdings.length === 0 && (
        <div className="card">
          <div className="empty-state">
            <div className="empty-state-icon">📊</div>
            <h3>Welcome to Portfolio Tracker</h3>
            <p style={{ marginBottom: 16 }}>Start by adding your first asset, then log transactions.</p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
              <button className="btn btn-primary" onClick={() => setShowAssetModal(true)}>+ Add First Asset</button>
              <button className="btn btn-secondary" onClick={() => onNavigate('settings')}>⚙ Configure Settings</button>
            </div>
          </div>
        </div>
      )}

      {showTxnModal && <TransactionModal onClose={() => setShowTxnModal(false)} />}
      {showAssetModal && <AssetModal onClose={() => setShowAssetModal(false)} />}
    </div>
  )
}
