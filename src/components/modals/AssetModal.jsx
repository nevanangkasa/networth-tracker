import React, { useState, useEffect, useRef, useMemo } from 'react'
import { usePortfolio } from '../../context/PortfolioContext.jsx'
import { ASSET_CLASSES, CURRENCIES, MANUAL_CLASSES, todayISO } from '../../utils/calculations.js'
import { searchSymbol } from '../../utils/api.js'

const DEFAULTS = {
  name: '', class: 'stocks', symbol: '', currency: 'USD',
  manualPrice: '', mortgageBalance: '', notes: '',
  depreciationRate: '', purchaseDate: '', ownershipPct: '',
  initialQty: '', initialAvgPrice: '', initialDate: todayISO(),
  // Cash-only: annual percentage yield. Surfaces a compound-interest
  // projection on the Cash & Savings page so users see what their balance
  // will grow to if left untouched.
  apy: '',
  // Marks the asset as a favorite. Favorites are flagged with a star in the
  // UI and trigger an extra confirmation step before a Sell transaction is
  // recorded so the user can't accidentally close a position they care about.
  favorite: false,
  // Bond-specific fields. Optional everywhere else but unlock structural
  // tracking (coupon income, maturity countdown, YTM) on the Bonds page.
  faceValue: '',         // par value per unit (native currency)
  couponRate: '',        // annual coupon rate (%)
  couponFrequency: '2',  // payments per year — semi-annual is most common
  maturityDate: '',
  issueDate: '',
  issuer: '',
  bondType: '',          // treasury / corporate / municipal / agency / foreign / other
  creditRating: '',      // AAA / AA / A / BBB / BB / B / CCC / D / NR
  callable: false,
  taxStatus: '',         // taxable / tax_exempt
}

const BOND_TYPES = [
  { value: '',           label: '— Select —'    },
  { value: 'treasury',   label: 'Treasury'      },
  { value: 'corporate',  label: 'Corporate'     },
  { value: 'municipal',  label: 'Municipal'     },
  { value: 'agency',     label: 'Agency'        },
  { value: 'foreign',    label: 'Foreign / Sovereign' },
  { value: 'other',      label: 'Other'         },
]
const CREDIT_RATINGS = ['', 'AAA','AA+','AA','AA-','A+','A','A-','BBB+','BBB','BBB-','BB','B','CCC','CC','C','D','NR']
const COUPON_FREQUENCIES = [
  { value: '1',  label: 'Annual (1×/yr)'         },
  { value: '2',  label: 'Semi-annual (2×/yr)'    },
  { value: '4',  label: 'Quarterly (4×/yr)'      },
  { value: '12', label: 'Monthly (12×/yr)'       },
]
const TAX_STATUSES = [
  { value: '',           label: '— Not specified —' },
  { value: 'taxable',    label: 'Taxable'           },
  { value: 'tax_exempt', label: 'Tax-Exempt'        },
]

export default function AssetModal({ asset, onClose, onSaved }) {
  const { addAsset, editAsset, addTransaction, editTransaction, data } = usePortfolio()
  const isEdit = !!asset?.id

  // When editing, find the earliest buy/deposit txn — that's the "initial position"
  // we'll let the user edit in place (qty, price, date). This surfaces the
  // original cost basis so users can correct a mis-entered purchase price
  // without hunting through the Transactions page.
  const initialTxn = useMemo(() => {
    if (!isEdit) return null
    return (data?.transactions || [])
      .filter(t => t.assetId === asset.id && (t.type === 'buy' || t.type === 'deposit'))
      .sort((a, b) => (a.date || '').localeCompare(b.date || ''))[0] || null
  }, [isEdit, asset?.id, data?.transactions])

  const [form, setForm] = useState(() => ({
    ...DEFAULTS,
    ...(asset || {}),
    // Pre-fill initial-position fields from the earliest buy/deposit when editing
    initialTxnId: initialTxn?.id || null,
    initialQty: initialTxn ? String(initialTxn.quantity ?? '') : '',
    initialAvgPrice: initialTxn ? String(initialTxn.price ?? '') : '',
    initialDate: initialTxn?.date || todayISO(),
  }))
  const [searchResults, setSearchResults] = useState([])
  const [searchState, setSearchState] = useState('idle') // idle | searching | found | none
  const searchTimer = useRef(null)

  function set(k, v) {
    setForm(f => {
      const next = { ...f, [k]: v }
      // When user switches to a class that depreciates by default, pre-fill the rate
      if (k === 'class' && !f.depreciationRate) {
        const info = ASSET_CLASSES.find(c => c.value === v)
        if (info?.defaultDepreciation) {
          next.depreciationRate = String(info.defaultDepreciation)
        }
      }
      return next
    })
  }

  // Auto-search ticker when user types symbol (debounced). Works WITHOUT a
  // Twelve Data API key — falls back to the Yahoo search proxy. The
  // `cancelled` flag guards setState after the modal unmounts mid-fetch.
  useEffect(() => {
    clearTimeout(searchTimer.current)
    if (!form.symbol || form.symbol.length < 1) {
      setSearchResults([])
      setSearchState('idle')
      return
    }
    if (!['stocks', 'crypto', 'commodities'].includes(form.class)) return

    let cancelled = false
    setSearchState('searching')
    searchTimer.current = setTimeout(async () => {
      const results = await searchSymbol(form.symbol, data.settings.apiKey)
      if (cancelled) return
      setSearchResults(results)
      setSearchState(results.length ? 'found' : 'none')
    }, 500)
    return () => { cancelled = true; clearTimeout(searchTimer.current) }
  }, [form.symbol, form.class, data.settings.apiKey])

  function applyMatch(match) {
    setForm(f => ({
      ...f,
      symbol: match.symbol,
      name: f.name || match.name,
      currency: match.currency || f.currency,
    }))
    setSearchResults([])
    setSearchState('found')
  }

  function handleSubmit(e) {
    e.preventDefault()
    if (!form.name.trim()) return
    // Build the payload conditionally so unset/empty fields don't overwrite
    // valid existing values when editing. Without this, simply re-saving an
    // asset wipes per-asset metadata that wasn't part of this form (e.g.
    // depreciationRate, ownershipPct) — the original bug we're fixing.
    const payload = {
      name: form.name.trim(),
      class: form.class,
      currency: form.currency,
      notes: form.notes.trim(),
    }
    if (form.symbol?.trim()) payload.symbol = form.symbol.trim().toUpperCase()
    if (form.manualPrice !== '' && form.manualPrice != null && !isNaN(parseFloat(form.manualPrice))) {
      payload.manualPrice = parseFloat(form.manualPrice)
    }
    if (form.class === 'property' && form.mortgageBalance !== '' && form.mortgageBalance != null) {
      payload.mortgageBalance = parseFloat(form.mortgageBalance) || 0
    } else if (form.class === 'property') {
      // Explicitly clear when user emptied the mortgage on a property
      payload.mortgageBalance = 0
    }
    if (form.depreciationRate !== '' && form.depreciationRate != null && !isNaN(parseFloat(form.depreciationRate))) {
      payload.depreciationRate = parseFloat(form.depreciationRate)
    }
    if (form.purchaseDate) payload.purchaseDate = form.purchaseDate
    if (form.ownershipPct !== '' && form.ownershipPct != null && !isNaN(parseFloat(form.ownershipPct))) {
      payload.ownershipPct = parseFloat(form.ownershipPct)
    }
    if (form.class === 'cash' && form.apy !== '' && !isNaN(parseFloat(form.apy))) {
      payload.apy = parseFloat(form.apy)
    }
    // Persist bond-specific fields only when class === 'bonds' so a class
    // change away from bonds doesn't leave stale coupon/face data hanging
    // on the record. Empty fields are saved as empty strings (truthy-checked
    // at read time) to allow blanking values via the edit form.
    if (form.class === 'bonds') {
      if (form.faceValue !== '' && !isNaN(parseFloat(form.faceValue))) {
        payload.faceValue = parseFloat(form.faceValue)
      }
      if (form.couponRate !== '' && !isNaN(parseFloat(form.couponRate))) {
        payload.couponRate = parseFloat(form.couponRate)
      }
      if (form.couponFrequency) payload.couponFrequency = parseInt(form.couponFrequency, 10)
      if (form.maturityDate) payload.maturityDate = form.maturityDate
      if (form.issueDate)    payload.issueDate    = form.issueDate
      if (form.issuer?.trim())       payload.issuer       = form.issuer.trim()
      if (form.bondType)             payload.bondType     = form.bondType
      if (form.creditRating)         payload.creditRating = form.creditRating
      if (form.taxStatus)            payload.taxStatus    = form.taxStatus
      payload.callable = !!form.callable
    }
    payload.favorite = !!form.favorite
    if (isEdit) {
      editAsset(asset.id, payload)
      // Sync the initial-position buy/deposit transaction if the user edited it
      const qty = parseFloat(form.initialQty)
      const price = parseFloat(form.initialAvgPrice)
      const hasInitial = qty > 0 && price >= 0
      if (initialTxn && hasInitial) {
        editTransaction(initialTxn.id, {
          quantity: qty,
          price,
          totalValue: qty * price,
          date: form.initialDate || initialTxn.date,
        })
      } else if (!initialTxn && hasInitial) {
        // No initial txn existed but user supplied one now — create it.
        // Cash accounts use 'deposit', everything else uses 'buy'. Tag the
        // generated txn so a re-save doesn't add a SECOND duplicate buy when
        // initialTxn is rederived from the freshly-saved data.
        addTransaction({
          assetId: asset.id,
          type: form.class === 'cash' ? 'deposit' : 'buy',
          date: form.initialDate || todayISO(),
          quantity: qty,
          price,
          totalValue: qty * price,
          notes: form.class === 'cash' ? 'Initial balance (added via edit)' : 'Initial position (added via edit)',
          tags: [],
        })
      }
      onSaved?.({ ...asset, ...payload })
    } else {
      const saved = addAsset(payload)
      // Auto-create initial buy/deposit transaction if qty + price provided
      const qty = parseFloat(form.initialQty)
      const price = parseFloat(form.initialAvgPrice)
      if (qty > 0 && price >= 0) {
        const isCash = form.class === 'cash'
        // All non-cash classes (including vehicles, jewelry, art, business, property)
        // get an initial Buy transaction so cost basis is recorded. Without this,
        // depreciating assets showed phantom profit = currentValue − 0.
        addTransaction({
          assetId: saved.id,
          type: isCash ? 'deposit' : 'buy',
          date: form.initialDate || todayISO(),
          quantity: qty,
          price,
          totalValue: qty * price,
          notes: isCash ? 'Initial balance' : 'Initial purchase',
          tags: [],
        })
      }
      onSaved?.(saved)
    }
    onClose()
  }

  const needsSymbol = ['stocks', 'crypto', 'commodities'].includes(form.class)
  const isProperty = form.class === 'property'

  return (
    <div className="modal-backdrop">
      <div className="modal">
        <div className="modal-header">
          <span className="modal-title">{isEdit ? 'Edit Asset' : 'Add Asset'}</span>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <div className="form-group">
              <label>Asset Name *</label>
              <input
                value={form.name}
                onChange={e => set('name', e.target.value)}
                placeholder="e.g. Apple Inc., Residential Property..."
                required autoFocus
              />
            </div>
            <div className="form-row">
              <div className="form-group mb-0">
                <label>Asset Class *</label>
                <select value={form.class} onChange={e => set('class', e.target.value)}>
                  {ASSET_CLASSES.map(c => (
                    <option key={c.value} value={c.value}>{c.icon} {c.label}</option>
                  ))}
                </select>
              </div>
              <div className="form-group mb-0">
                <label>Priced In *</label>
                <select value={form.currency} onChange={e => set('currency', e.target.value)}>
                  {CURRENCIES.map(c => <option key={c}>{c}</option>)}
                </select>
                <div className="form-hint" style={{ fontSize: 11 }}>
                  Currency this asset is priced in (e.g. IDR for a Jakarta stock, USD for Apple). Will be auto-converted to your base currency for display.
                </div>
              </div>
            </div>

            {needsSymbol && (
              <div className="form-group" style={{ position: 'relative' }}>
                <label>
                  Ticker Symbol{' '}
                  {searchState === 'searching' && <span className="muted" style={{ fontWeight: 400 }}>searching…</span>}
                  {searchState === 'found' && searchResults.length > 0 && <span className="gain" style={{ fontWeight: 400 }}>✓ {searchResults.length} match{searchResults.length > 1 ? 'es' : ''}</span>}
                  {searchState === 'none' && form.symbol && <span className="loss" style={{ fontWeight: 400 }}>✕ not found — manual entry</span>}
                </label>
                <input
                  value={form.symbol}
                  onChange={e => set('symbol', e.target.value.toUpperCase())}
                  placeholder={
                    form.class === 'crypto' ? 'BTC/USD, ETH/USD, SOL/USD' :
                    form.class === 'commodities' ? 'XAU/USD, XAG/USD' :
                    'AAPL, BBCA.JK, MSFT'
                  }
                  autoComplete="off"
                />
                {searchResults.length > 0 && searchState === 'found' && (
                  <div style={{
                    position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 10,
                    background: 'var(--card)', border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-sm)', marginTop: 4,
                    maxHeight: 240, overflowY: 'auto', boxShadow: 'var(--shadow)'
                  }}>
                    {searchResults.map((r, i) => (
                      <button
                        key={`${r.symbol}-${r.exchange}-${i}`}
                        type="button"
                        onClick={() => applyMatch(r)}
                        style={{
                          display: 'block', width: '100%', textAlign: 'left',
                          padding: '8px 12px', background: 'none', border: 'none',
                          borderBottom: '1px solid var(--border)',
                          color: 'var(--text)', cursor: 'pointer', fontSize: 12,
                        }}
                        onMouseEnter={e => e.currentTarget.style.background = 'var(--card-hover)'}
                        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                      >
                        <div style={{ fontWeight: 600 }}>
                          {r.symbol} <span className="muted" style={{ fontWeight: 400 }}>· {r.currency}</span>
                        </div>
                        <div className="muted" style={{ fontSize: 11 }}>
                          {r.name} {r.exchange && `— ${r.exchange}`} {r.country && `(${r.country})`}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
                <div className="form-hint">
                  {data.settings.apiKey
                    ? 'Type to search · Click a match to auto-fill · Live prices via Twelve Data + Yahoo fallback'
                    : 'Type to search · Click a match to auto-fill · Free Yahoo Finance (no API key needed)'}
                </div>
              </div>
            )}

            {(ASSET_CLASSES.find(a => a.value === form.class) &&
              !needsSymbol && form.class !== 'cash') && (
              <div className="form-group">
                <label>Current Value ({form.currency}) — optional</label>
                <input
                  type="number" step="any" min="0"
                  value={form.manualPrice}
                  onChange={e => set('manualPrice', e.target.value)}
                  placeholder="Market value today (not the purchase price)"
                />
                <div className="form-hint" style={{ fontSize: 11 }}>
                  This is the <strong>current</strong> market value. Enter your purchase price below
                  under <em>Initial Position</em> — cost basis drives your P&amp;L.
                </div>
              </div>
            )}

            {isProperty && (
              <div className="form-group">
                <label>Outstanding Mortgage Balance ({form.currency})</label>
                <input
                  type="number" step="any" min="0"
                  value={form.mortgageBalance}
                  onChange={e => set('mortgageBalance', e.target.value)}
                  placeholder="0"
                />
                <div className="form-hint">Net equity = current value − mortgage balance</div>
              </div>
            )}

            {/* Fractional ownership — applies to any non-cash asset */}
            {form.class !== 'cash' && (
              <div className="form-group">
                <label>Ownership Share (%)</label>
                <input
                  type="number" step="any" min="0" max="100"
                  value={form.ownershipPct}
                  onChange={e => set('ownershipPct', e.target.value)}
                  placeholder="100 (full ownership) — e.g. 50 if you co-own with a partner"
                />
                <div className="form-hint" style={{ fontSize: 11 }}>
                  Leave blank or 100 for full ownership. If co-owned (e.g. 50% share of a building),
                  all values, cost basis, P&L, and income are scaled by this percentage.
                  {form.class === 'property' && ' Mortgage balance is NOT scaled — enter your own share of the mortgage directly.'}
                </div>
              </div>
            )}

            {MANUAL_CLASSES.includes(form.class) && (
              <div className="form-row">
                <div className="form-group mb-0">
                  <label>Annual Depreciation (%)</label>
                  <input
                    type="number" step="any" min="0" max="100"
                    value={form.depreciationRate}
                    onChange={e => set('depreciationRate', e.target.value)}
                    placeholder={form.class === 'vehicles' ? '15 (typical)' : 'Leave blank'}
                  />
                  <div className="form-hint" style={{ fontSize: 11 }}>
                    Auto-calculates current value: cost × (1 − rate)^years since purchase
                  </div>
                </div>
                <div className="form-group mb-0">
                  <label>Purchase Date</label>
                  <input
                    type="date"
                    value={form.purchaseDate}
                    onChange={e => set('purchaseDate', e.target.value)}
                  />
                  <div className="form-hint" style={{ fontSize: 11 }}>
                    Defaults to first buy transaction date if blank
                  </div>
                </div>
              </div>
            )}

            {/* Bond-specific structural fields. Hidden unless the class is
                'bonds' so the modal stays focused for other asset types. */}
            {form.class === 'bonds' && (
              <div className="card card-sm" style={{ background: 'var(--bg-secondary)', padding: 12, marginBottom: 12 }}>
                <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Bond Details
                </div>
                <div className="form-row">
                  <div className="form-group mb-0">
                    <label>Face / Par Value per unit ({form.currency})</label>
                    <input
                      type="number" step="any" min="0"
                      value={form.faceValue}
                      onChange={e => set('faceValue', e.target.value)}
                      placeholder="e.g. 1000"
                    />
                    <div className="form-hint" style={{ fontSize: 11 }}>
                      Amount returned per unit at maturity. Different from the
                      market price you paid for the bond.
                    </div>
                  </div>
                  <div className="form-group mb-0">
                    <label>Coupon Rate (% per year)</label>
                    <input
                      type="number" step="any" min="0" max="100"
                      value={form.couponRate}
                      onChange={e => set('couponRate', e.target.value)}
                      placeholder="e.g. 4.5"
                    />
                  </div>
                </div>
                <div className="form-row">
                  <div className="form-group mb-0">
                    <label>Coupon Frequency</label>
                    <select
                      value={form.couponFrequency}
                      onChange={e => set('couponFrequency', e.target.value)}
                    >
                      {COUPON_FREQUENCIES.map(f => (
                        <option key={f.value} value={f.value}>{f.label}</option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group mb-0">
                    <label>Maturity Date</label>
                    <input
                      type="date"
                      value={form.maturityDate}
                      onChange={e => set('maturityDate', e.target.value)}
                    />
                  </div>
                </div>
                <div className="form-row">
                  <div className="form-group mb-0">
                    <label>Issuer</label>
                    <input
                      type="text"
                      value={form.issuer}
                      onChange={e => set('issuer', e.target.value)}
                      placeholder="e.g. US Treasury, Apple Inc., City of NYC"
                    />
                  </div>
                  <div className="form-group mb-0">
                    <label>Bond Type</label>
                    <select
                      value={form.bondType}
                      onChange={e => set('bondType', e.target.value)}
                    >
                      {BOND_TYPES.map(t => (
                        <option key={t.value} value={t.value}>{t.label}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="form-row">
                  <div className="form-group mb-0">
                    <label>Issue Date (optional)</label>
                    <input
                      type="date"
                      value={form.issueDate}
                      onChange={e => set('issueDate', e.target.value)}
                    />
                  </div>
                  <div className="form-group mb-0">
                    <label>Credit Rating (optional)</label>
                    <select
                      value={form.creditRating}
                      onChange={e => set('creditRating', e.target.value)}
                    >
                      {CREDIT_RATINGS.map(r => (
                        <option key={r} value={r}>{r || '— Not rated —'}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="form-row">
                  <div className="form-group mb-0">
                    <label>Tax Status</label>
                    <select
                      value={form.taxStatus}
                      onChange={e => set('taxStatus', e.target.value)}
                    >
                      {TAX_STATUSES.map(t => (
                        <option key={t.value} value={t.value}>{t.label}</option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group mb-0">
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 24, cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={!!form.callable}
                        onChange={e => set('callable', e.target.checked)}
                        style={{ width: 'auto' }}
                      />
                      <span>Callable (issuer can redeem early)</span>
                    </label>
                  </div>
                </div>
                <div className="form-hint" style={{ marginTop: 8, fontSize: 11 }}>
                  Reference data only — these fields are stored with the asset
                  so the full bond's structure stays visible in its detail view.
                  Log actual coupon payments as Interest Income transactions
                  whenever you receive them.
                </div>
              </div>
            )}

            {form.class !== 'cash' && (
              <div className="card card-sm" style={{ background: 'var(--bg-secondary)', padding: 12, marginBottom: 12 }}>
                <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Initial Position {isEdit ? (initialTxn ? '(editing original buy transaction)' : '(add one)') : '(optional)'}
                </div>
                <div className="form-row">
                  <div className="form-group mb-0">
                    <label>
                      {form.class === 'stocks' ? '# of Shares' :
                       form.class === 'crypto' ? '# of Coins' :
                       form.class === 'property' ? 'Units (usually 1)' :
                       form.class === 'commodities' ? '# of Units' :
                       'Quantity'}
                    </label>
                    <input
                      type="number" step="any" min="0"
                      value={form.initialQty}
                      onChange={e => set('initialQty', e.target.value)}
                      placeholder="e.g. 10"
                    />
                  </div>
                  <div className="form-group mb-0">
                    <label>Avg Buy Price ({form.currency})</label>
                    <input
                      type="number" step="any" min="0"
                      value={form.initialAvgPrice}
                      onChange={e => set('initialAvgPrice', e.target.value)}
                      placeholder="e.g. 150.00"
                    />
                  </div>
                </div>
                <div className="form-group mb-0" style={{ marginTop: 8 }}>
                  <label>Purchase Date</label>
                  <input
                    type="date"
                    value={form.initialDate}
                    onChange={e => set('initialDate', e.target.value)}
                  />
                </div>
                <div className="form-hint" style={{ marginTop: 6 }}>
                  Creates a Buy transaction so cost basis and quantity are tracked. Leave blank to add transactions later.
                </div>
              </div>
            )}
            {form.class === 'cash' && !isEdit && (
              <div className="card card-sm" style={{ background: 'var(--bg-secondary)', padding: 12, marginBottom: 12 }}>
                <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Initial Balance (optional)
                </div>
                <div className="form-group mb-0">
                  <label>Amount ({form.currency})</label>
                  <input
                    type="number" step="any" min="0"
                    value={form.initialQty}
                    onChange={e => {
                      set('initialQty', e.target.value)
                      set('initialAvgPrice', '1')
                    }}
                    placeholder="e.g. 5000"
                  />
                </div>
              </div>
            )}
            {form.class === 'cash' && (
              <div className="form-group">
                <label>APY (%) <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(optional)</span></label>
                <input
                  type="number" step="any" min="0" max="100"
                  value={form.apy}
                  onChange={e => set('apy', e.target.value)}
                  placeholder="e.g. 4.5 for a high-yield savings account"
                />
                <div className="form-hint">
                  Annual percentage yield. When set, the Cash &amp; Savings page shows a compound-growth projection for this account.
                </div>
              </div>
            )}

            <div className="form-group">
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={!!form.favorite}
                  onChange={e => set('favorite', e.target.checked)}
                  style={{ width: 'auto' }}
                />
                <span>⭐ Mark as Favorite</span>
              </label>
              <div className="form-hint" style={{ fontSize: 11 }}>
                Favorites are highlighted with a star and require an extra
                confirmation step before a Sell transaction is recorded, so
                you won't accidentally close a position you care about.
              </div>
            </div>

            <div className="form-group mb-0">
              <label>Notes</label>
              <textarea
                value={form.notes}
                onChange={e => set('notes', e.target.value)}
                placeholder="Optional notes..."
                rows={2}
              />
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary">
              {isEdit ? 'Save Changes' : 'Add Asset'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
