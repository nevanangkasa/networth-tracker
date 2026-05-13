import React, { useState, useMemo } from 'react'
import { usePortfolio } from '../context/PortfolioContext.jsx'
import { CURRENCIES, getFxRate } from '../utils/calculations.js'

// Small currency converter widget. Pulls rates from data.fxCache (populated
// by the app's Yahoo / Twelve Data FX fetcher on Refresh Prices), so the
// calculator always uses the same rates as the rest of the app.
export default function FxCalculator() {
  const { data, refreshPrices, priceLoading } = usePortfolio()
  const [from, setFrom] = useState(data.settings.baseCurrency || 'USD')
  const [to, setTo] = useState(from === 'USD' ? 'EUR' : 'USD')
  const [amount, setAmount] = useState('1')

  const rate = getFxRate(from, to, data.fxCache)
  const numAmount = parseFloat(amount) || 0
  const converted = numAmount * rate

  // Pick a timestamp to display freshness
  const entry = data.fxCache[`${from}_${to}`] || data.fxCache[`${to}_${from}`]
  const ts = entry?.timestamp
  const source = entry?.source || 'unknown'
  const ageMins = ts ? Math.floor((Date.now() - ts) / 60000) : null
  const freshness = ageMins === null
    ? 'no rate cached — click Refresh'
    : ageMins < 1 ? 'just now'
    : ageMins < 60 ? `${ageMins}m ago`
    : ageMins < 1440 ? `${Math.floor(ageMins / 60)}h ago`
    : `${Math.floor(ageMins / 1440)}d ago`

  const currencies = CURRENCIES.filter(c => c !== 'BTC')

  // Bonus: a compact rate table against base currency
  const base = data.settings.baseCurrency || 'USD'
  const rateTable = useMemo(() => {
    return currencies.filter(c => c !== base).map(c => {
      const r = getFxRate(base, c, data.fxCache)
      const inv = getFxRate(c, base, data.fxCache)
      return { code: c, rate: r, inverse: inv }
    })
  }, [data.fxCache, base])

  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title">💱 Currency Converter</span>
        <button
          className="btn btn-ghost btn-xs"
          onClick={() => refreshPrices({ force: true })}
          disabled={priceLoading}
          title="Refresh FX rates from Yahoo Finance"
        >
          {priceLoading ? '…' : '↻'} Refresh
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 10, alignItems: 'end', marginBottom: 8 }}>
        <div>
          <label style={{ fontSize: 11, color: 'var(--text-muted)' }}>From</label>
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              type="number"
              step="any"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              style={{ flex: 1 }}
            />
            <select value={from} onChange={e => setFrom(e.target.value)} style={{ width: 90 }}>
              {currencies.map(c => <option key={c}>{c}</option>)}
            </select>
          </div>
        </div>
        <button
          className="btn btn-ghost btn-sm"
          style={{ marginBottom: 2 }}
          onClick={() => { setFrom(to); setTo(from) }}
          title="Swap"
        >⇄</button>
        <div>
          <label style={{ fontSize: 11, color: 'var(--text-muted)' }}>To</label>
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              type="text"
              readOnly
              value={converted.toLocaleString('en-US', { maximumFractionDigits: 4 })}
              style={{ flex: 1, fontWeight: 600 }}
            />
            <select value={to} onChange={e => setTo(e.target.value)} style={{ width: 90 }}>
              {currencies.map(c => <option key={c}>{c}</option>)}
            </select>
          </div>
        </div>
      </div>

      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 12 }}>
        1 {from} = <strong style={{ color: 'var(--text)' }}>{rate.toFixed(6)}</strong> {to}
        {' · '}Source: <span style={{
          textTransform: 'capitalize',
          color: source === 'fallback' ? 'var(--loss)' : undefined,
          fontWeight: source === 'fallback' ? 600 : undefined,
        }}>{source}</span>
        {' · '}Updated {freshness}
      </div>
      {source === 'fallback' && (
        <div style={{
          fontSize: 11, color: 'var(--loss)',
          background: 'rgba(244, 63, 94, 0.08)',
          border: '1px solid rgba(244, 63, 94, 0.25)',
          padding: '6px 8px', borderRadius: 4, marginBottom: 12,
        }}>
          ⚠ Using offline fallback rates (may be weeks old). Click <strong>↻ Refresh</strong> when online for live Yahoo rates.
        </div>
      )}

      <details>
        <summary style={{ cursor: 'pointer', fontSize: 12, color: 'var(--text-muted)' }}>
          Show rate table vs {base}
        </summary>
        <table style={{ width: '100%', fontSize: 12, marginTop: 8 }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left', color: 'var(--text-muted)', fontSize: 10 }}>Currency</th>
              <th style={{ textAlign: 'right', color: 'var(--text-muted)', fontSize: 10 }}>1 {base} =</th>
              <th style={{ textAlign: 'right', color: 'var(--text-muted)', fontSize: 10 }}>1 {'x'} = {base}</th>
            </tr>
          </thead>
          <tbody>
            {rateTable.map(r => (
              <tr key={r.code}>
                <td style={{ padding: '4px 0', fontWeight: 600 }}>{r.code}</td>
                <td style={{ padding: '4px 0', textAlign: 'right' }}>{r.rate.toLocaleString('en-US', { maximumFractionDigits: 6 })}</td>
                <td style={{ padding: '4px 0', textAlign: 'right', color: 'var(--text-muted)' }}>{r.inverse.toLocaleString('en-US', { maximumFractionDigits: 6 })}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  )
}
