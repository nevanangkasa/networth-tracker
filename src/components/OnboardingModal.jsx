import React, { useState, useEffect } from 'react'
import { usePortfolio } from '../context/PortfolioContext.jsx'
import { generateId, todayISO } from '../utils/calculations.js'

// First-run onboarding. Shows once when there's no data at all (fresh
// install) and disappears as soon as the user takes ANY action — adds an
// asset themselves, loads sample data, or dismisses. We never re-show it.
const DISMISSED_KEY = 'portfolio-onboarding-dismissed'

export default function OnboardingModal() {
  const { data, loading, importJson } = usePortfolio()
  const [dismissed, setDismissed] = useState(() => {
    try { return localStorage.getItem(DISMISSED_KEY) === 'true' } catch { return false }
  })
  const [showSample, setShowSample] = useState(false)

  useEffect(() => {
    if (data.assets?.length > 0 || data.transactions?.length > 0) {
      // User has data; ensure the modal is dismissed for future runs
      try { localStorage.setItem(DISMISSED_KEY, 'true') } catch {}
    }
  }, [data.assets, data.transactions])

  if (loading || dismissed) return null
  // Don't show if user already has anything in their portfolio
  if ((data.assets || []).length > 0 || (data.transactions || []).length > 0) return null

  function dismiss() {
    try { localStorage.setItem(DISMISSED_KEY, 'true') } catch {}
    setDismissed(true)
  }

  function loadSample() {
    const sample = buildSampleData(data.settings?.baseCurrency || 'USD')
    importJson(JSON.stringify(sample))
    dismiss()
  }

  return (
    <div className="modal-backdrop" style={{ zIndex: 200 }}>
      <div className="modal" style={{ maxWidth: 540 }}>
        <div className="modal-header">
          <span className="modal-title" style={{ fontSize: 22, fontWeight: 700 }}>
            Welcome 👋
          </span>
          <button className="modal-close" onClick={dismiss}>×</button>
        </div>
        <div className="modal-body">
          <p style={{ marginTop: 0, lineHeight: 1.6 }}>
            This is a <strong>local-first portfolio tracker</strong>. All data lives
            in a JSON file on your machine — nothing is sent to any server except
            anonymous price lookups (Yahoo Finance) and FX rates.
          </p>

          <div style={{
            background: 'var(--bg-secondary)', padding: 14, borderRadius: 8,
            marginTop: 14, marginBottom: 14, fontSize: 13, lineHeight: 1.6,
          }}>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>What you can track</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, color: 'var(--text-muted)', fontSize: 12 }}>
              <div>📈 Stocks &amp; ETFs (live prices)</div>
              <div>🪙 Crypto (live prices)</div>
              <div>🏠 Property &amp; mortgages</div>
              <div>💵 Cash &amp; savings (multi-currency)</div>
              <div>🚗 Vehicles (with depreciation)</div>
              <div>📜 Bonds, private equity</div>
              <div>💎 Jewelry, art, collectibles</div>
              <div>🧾 Recurring expenses</div>
            </div>
          </div>

          {!showSample ? (
            <>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
                <button className="btn btn-primary" onClick={dismiss} style={{ flex: 1, minWidth: 160 }}>
                  Start fresh →
                </button>
                <button className="btn btn-secondary" onClick={() => setShowSample(true)} style={{ flex: 1, minWidth: 160 }}>
                  Try with sample data
                </button>
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8 }}>
                Sample data lets you explore the features without entering anything.
                You can clear it anytime via Settings → Reset Data.
              </div>
            </>
          ) : (
            <>
              <p style={{ fontSize: 13, lineHeight: 1.5 }}>
                Sample data includes a stock position, a savings account, a property with
                mortgage, a vehicle, recent dividend &amp; salary income, and a few months
                of net-worth snapshots. You can delete any of it later.
              </p>
              <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
                <button className="btn btn-secondary" onClick={() => setShowSample(false)} style={{ flex: 1 }}>
                  ← Back
                </button>
                <button className="btn btn-primary" onClick={loadSample} style={{ flex: 1 }}>
                  Load sample data
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// Build a small but realistic sample dataset. Dates anchored relative to
// today so the charts always look populated regardless of when the user
// installs the app.
function buildSampleData(base) {
  const today = todayISO()
  const isoNDaysAgo = (n) => {
    const d = new Date(); d.setDate(d.getDate() - n)
    return d.toISOString().slice(0, 10)
  }
  const isoNMonthsAgo = (n) => {
    const d = new Date(); d.setMonth(d.getMonth() - n)
    return d.toISOString().slice(0, 10)
  }

  const id = () => generateId()

  const stockId = id(), btcId = id(), cashId = id(), savId = id(), houseId = id(), carId = id()

  return {
    settings: { baseCurrency: base, apiKey: '', autoRefresh: false, lastSnapshotDate: today },
    assets: [
      { id: stockId, name: 'Apple Inc', class: 'stocks', symbol: 'AAPL', currency: 'USD', notes: 'Sample position' },
      { id: btcId,   name: 'Bitcoin',   class: 'crypto', symbol: 'BTC-USD', currency: 'USD', notes: '' },
      { id: cashId,  name: 'Checking',  class: 'cash',   currency: 'USD', notes: 'Daily expenses' },
      { id: savId,   name: 'High-Yield Savings', class: 'cash', currency: 'USD', notes: '4.5% APY' },
      { id: houseId, name: 'Home',      class: 'property', currency: 'USD', manualPrice: 600000, mortgageBalance: 320000, purchaseDate: isoNMonthsAgo(36), notes: '' },
      { id: carId,   name: 'Car',       class: 'vehicles', currency: 'USD', depreciationRate: 15, purchaseDate: isoNMonthsAgo(24), notes: '' },
    ],
    transactions: [
      { id: id(), assetId: stockId, type: 'buy',  date: isoNMonthsAgo(18), quantity: 30, price: 165, totalValue: 4950, notes: 'Initial position', tags: [] },
      { id: id(), assetId: stockId, type: 'buy',  date: isoNMonthsAgo(6),  quantity: 10, price: 195, totalValue: 1950, notes: '', tags: [] },
      { id: id(), assetId: stockId, type: 'dividend', date: isoNMonthsAgo(3), quantity: 1, price: 38,  totalValue: 38, notes: 'Q dividend', tags: [] },
      { id: id(), assetId: btcId,   type: 'buy',  date: isoNMonthsAgo(12), quantity: 0.15, price: 42000, totalValue: 6300, notes: '', tags: [] },
      { id: id(), assetId: cashId,  type: 'deposit', date: isoNMonthsAgo(18), quantity: 5000, price: 1, totalValue: 5000, notes: 'Initial balance', tags: [] },
      { id: id(), assetId: savId,   type: 'deposit', date: isoNMonthsAgo(18), quantity: 12000, price: 1, totalValue: 12000, notes: 'Initial balance', tags: [] },
      { id: id(), assetId: cashId,  type: 'salary', date: isoNMonthsAgo(2), quantity: 1, price: 6500, totalValue: 6500, notes: 'Monthly salary', tags: [] },
      { id: id(), assetId: cashId,  type: 'salary', date: isoNMonthsAgo(1), quantity: 1, price: 6500, totalValue: 6500, notes: 'Monthly salary', tags: [] },
      { id: id(), assetId: savId,   type: 'interest_income', date: isoNMonthsAgo(1), quantity: 1, price: 47, totalValue: 47, notes: '', tags: [] },
      { id: id(), assetId: cashId,  type: 'expense', date: isoNDaysAgo(15), quantity: 1, price: 320, totalValue: 320, notes: 'Groceries', tags: [] },
      { id: id(), assetId: cashId,  type: 'expense', date: isoNDaysAgo(7),  quantity: 1, price: 180, totalValue: 180, notes: 'Utilities', tags: [] },
      { id: id(), assetId: carId,   type: 'buy',  date: isoNMonthsAgo(24), quantity: 1, price: 32000, totalValue: 32000, notes: 'Initial purchase', tags: [] },
      { id: id(), assetId: houseId, type: 'buy',  date: isoNMonthsAgo(36), quantity: 1, price: 540000, totalValue: 540000, notes: 'Initial purchase', tags: [] },
      { id: id(), assetId: houseId, type: 'rental_income', date: isoNMonthsAgo(2), quantity: 1, price: 1800, totalValue: 1800, notes: 'Monthly rent', tags: [] },
      { id: id(), assetId: houseId, type: 'rental_income', date: isoNMonthsAgo(1), quantity: 1, price: 1800, totalValue: 1800, notes: 'Monthly rent', tags: [] },
    ],
    // Mirror the property's mortgageBalance as a real Liability row.
    // The auto-create-on-addAsset flow doesn't run when sample data is
    // imported wholesale via importJson, so without this row the property's
    // mortgage was reflected on the Property page (via mortgageBalance)
    // but never subtracted from Total Liabilities — overstating net worth.
    liabilities: [
      {
        id: id(),
        name: 'Home Mortgage',
        type: 'mortgage',
        balance: 320000,
        currency: 'USD',
        startDate: isoNMonthsAgo(36),
        linkedAssetId: houseId,
        notes: 'Auto-created from property mortgage',
      },
    ],
    snapshots: [],
    expenses: [
      { id: id(), name: 'Rent',       amount: 1500, currency: base, category: 'Housing',         tags: ['essential'], recurrence: 'monthly', startDate: isoNMonthsAgo(12), endDate: '', sources: [], sourceAssetIds: [] },
      { id: id(), name: 'Netflix',    amount: 16,   currency: base, category: 'Subscriptions',   tags: [],            recurrence: 'monthly', startDate: isoNMonthsAgo(24), endDate: '', sources: [], sourceAssetIds: [] },
      { id: id(), name: 'Gym',        amount: 39,   currency: base, category: 'Healthcare',      tags: [],            recurrence: 'monthly', startDate: isoNMonthsAgo(8),  endDate: '', sources: [], sourceAssetIds: [] },
    ],
    expenseCategories: [],
    pricesCache: {},
    fxCache: {},
  }
}
