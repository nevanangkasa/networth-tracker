import React, { useState } from 'react'
import { usePortfolio } from '../context/PortfolioContext.jsx'
import { formatCurrency, getFxRate, todayISO, generateId, amortizationSchedule } from '../utils/calculations.js'
import LiabilityModal from './modals/LiabilityModal.jsx'
import CurrencyToggle from './CurrencyToggle.jsx'

const TYPE_LABELS = {
  mortgage: 'Mortgage', loan: 'Loan', credit: 'Credit Card',
  business: 'Business Loan', other: 'Other'
}

export default function Liabilities() {
  const {
    data, holdings, deleteLiability, editLiability, editAsset, addTransaction,
    netWorthStats, pushUndo,
  } = usePortfolio()
  const [showModal, setShowModal] = useState(false)
  const [editingLiability, setEditingLiability] = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [paymentFor, setPaymentFor] = useState(null)
  const [paymentForm, setPaymentForm] = useState({
    amount: '', date: todayISO(), type: 'payment', notes: '', sourceAssetId: '',
  })
  const [search, setSearch] = useState('')
  const [filterType, setFilterType] = useState('all')

  const cashAccounts = holdings.filter(h => h.class === 'cash')

  function applyPayment() {
    if (!paymentFor) return
    const amt = parseFloat(paymentForm.amount) || 0
    if (amt <= 0) return
    const current = parseFloat(paymentFor.balance) || 0
    const newBalance = paymentForm.type === 'payment'
      ? Math.max(0, current - amt)
      : current + amt
    // Pre-check: if paying from a cash account, make sure that account has
    // enough native-currency balance. Without this, the user could draw
    // 100k from a 1k checking account and the cash row would silently go
    // effectively negative on paper.
    if (paymentForm.type === 'payment' && paymentForm.sourceAssetId) {
      const source = data.assets.find(a => a.id === paymentForm.sourceAssetId)
      const sourceCcy = source?.currency || paymentFor.currency
      const fx = getFxRate(paymentFor.currency, sourceCcy, data.fxCache || {})
      const amtInSourceCcy = amt * fx
      const sourceHolding = cashAccounts.find(h => h.id === paymentForm.sourceAssetId)
      const available = sourceHolding?.currentValueNative ?? 0
      if (amtInSourceCcy > available + 1e-6) {
        alert(
          `${source?.name || 'Source account'} only has ${available.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${sourceCcy} available. ` +
          `This payment needs ${amtInSourceCcy.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${sourceCcy}. ` +
          `Pick a different account or reduce the amount.`
        )
        return
      }
    }
    pushUndo(`${paymentForm.type === 'payment' ? 'Payment on' : 'Charge to'} ${paymentFor.name}`)
    const history = Array.isArray(paymentFor.history) ? paymentFor.history : []
    const groupId = generateId()
    const entry = {
      id: generateId(),
      date: paymentForm.date,
      type: paymentForm.type,
      amount: amt,
      balanceAfter: newBalance,
      notes: paymentForm.notes || '',
      sourceAssetId: paymentForm.sourceAssetId || null,
      // Tag the history entry with the same groupId so a cascade-delete of
      // the cash withdrawal can also reverse the liability balance later
      // (future work — for now it just exists for traceability).
      transferGroupId: paymentForm.sourceAssetId ? groupId : null,
    }
    editLiability(paymentFor.id, { balance: newBalance, history: [entry, ...history] })

    // If a cash source is set AND this is a payment, also draw from that
    // cash account so cashflow reflects reality. The cash withdrawal is
    // converted from the liability's currency into the cash account's
    // currency (e.g. paying an IDR mortgage from a USD account).
    if (paymentForm.type === 'payment' && paymentForm.sourceAssetId) {
      const source = data.assets.find(a => a.id === paymentForm.sourceAssetId)
      const sourceCcy = source?.currency || paymentFor.currency
      const fx = getFxRate(paymentFor.currency, sourceCcy, data.fxCache || {})
      const amtInSourceCcy = amt * fx
      addTransaction({
        date: paymentForm.date,
        assetId: paymentForm.sourceAssetId,
        type: 'liability_payment',
        quantity: amtInSourceCcy,
        price: 1,
        totalValue: amtInSourceCcy,
        notes: `Payment to ${paymentFor.name}${paymentForm.notes ? ' · ' + paymentForm.notes : ''}` +
          (sourceCcy !== paymentFor.currency
            ? ` (${formatCurrency(amt, paymentFor.currency)} converted)`
            : ''),
        transferGroupId: groupId,
        liabilityId: paymentFor.id, // for future cascade-back
      })
    }

    // Keep linked-asset (property) mortgageBalance in sync if this liability
    // was auto-created from a property mortgage. Pass skipLiabilitySync so the
    // editAsset call doesn't bounce back and overwrite the liability name we
    // may have customised.
    if (paymentFor.linkedAssetId) {
      editAsset(paymentFor.linkedAssetId, { mortgageBalance: newBalance }, { skipLiabilitySync: true })
    }

    setPaymentFor(null)
    setPaymentForm({ amount: '', date: todayISO(), type: 'payment', notes: '', sourceAssetId: '' })
  }

  const cur = data.settings.baseCurrency
  const { totalAssetsBase, totalLiabilitiesBase, netWorthBase } = netWorthStats

  const allEnriched = data.liabilities.map(l => {
    const rate = getFxRate(l.currency, cur, data.fxCache)
    return { ...l, balanceBase: (parseFloat(l.balance) || 0) * rate, rate }
  })
  const q = search.trim().toLowerCase()
  const enriched = allEnriched.filter(l => {
    if (filterType !== 'all' && l.type !== filterType) return false
    if (!q) return true
    return `${l.name || ''} ${l.notes || ''} ${l.type || ''}`.toLowerCase().includes(q)
  })

  const byType = {}
  for (const l of allEnriched) {
    byType[l.type] = (byType[l.type] || 0) + l.balanceBase
  }

  const liabilityRatio = totalAssetsBase > 0
    ? (totalLiabilitiesBase / totalAssetsBase) * 100 : 0

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Liabilities</div>
          <div className="page-subtitle">{data.liabilities.length} items</div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <CurrencyToggle />
          <button className="btn btn-primary btn-sm" onClick={() => { setEditingLiability(null); setShowModal(true) }}>
            + Add Liability
          </button>
        </div>
      </div>

      <div className="metrics-grid">
        <div className="metric-card">
          <div className="metric-label">Total Liabilities</div>
          <div className={`metric-value ${totalLiabilitiesBase > 0 ? 'loss' : 'muted'}`}>
            {formatCurrency(totalLiabilitiesBase, cur, true)}
          </div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Total Assets</div>
          <div className="metric-value">{formatCurrency(totalAssetsBase, cur, true)}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Net Worth</div>
          <div className={`metric-value ${netWorthBase >= 0 ? '' : 'loss'}`}>
            {formatCurrency(netWorthBase, cur, true)}
          </div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Debt-to-Assets Ratio</div>
          <div className={`metric-value ${liabilityRatio > 50 ? 'loss' : liabilityRatio > 30 ? 'accent-text' : 'gain'}`}>
            {liabilityRatio.toFixed(1)}%
          </div>
        </div>
      </div>

      {data.liabilities.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <div className="empty-state-icon">▽</div>
            <h3>No liabilities recorded</h3>
            <p style={{ marginBottom: 16 }}>Add mortgages, loans, and credit card balances to get an accurate net worth.</p>
            <button className="btn btn-primary" onClick={() => setShowModal(true)}>+ Add Liability</button>
          </div>
        </div>
      ) : (
        <>
          {/* Breakdown by type */}
          {Object.keys(byType).length > 1 && (
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="card-header">
                <span className="card-title">By Type</span>
              </div>
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                {Object.entries(byType).map(([type, amount]) => (
                  <div key={type}>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>{TYPE_LABELS[type] || type}</div>
                    <div style={{ fontWeight: 600, color: 'var(--loss)' }}>{formatCurrency(amount, cur, true)}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="filters-bar" style={{ marginBottom: 12 }}>
            <input
              type="search"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="🔍 Search name, notes…"
              style={{ width: 240 }}
            />
            <select value={filterType} onChange={e => setFilterType(e.target.value)} style={{ width: 'auto', minWidth: 160 }}>
              <option value="all">All types</option>
              {Object.entries(TYPE_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
            {(search || filterType !== 'all') && (
              <button className="btn btn-ghost btn-sm" onClick={() => { setSearch(''); setFilterType('all') }}>
                ✕ Clear
              </button>
            )}
            <span style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 'auto' }}>
              {enriched.length} shown
            </span>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Type</th>
                  <th>Currency</th>
                  <th className="text-right">Balance (Native)</th>
                  <th className="text-right">Balance ({cur})</th>
                  <th>Notes</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {enriched.map(l => {
                  // Inline payoff projection — only computed when both fields present
                  const proj = (l.interestRate != null && l.monthlyPayment != null)
                    ? amortizationSchedule(l.balance, l.interestRate, l.monthlyPayment)
                    : null
                  return (
                  <tr key={l.id}>
                    <td style={{ fontWeight: 600 }}>
                      {l.name}
                      {proj && !proj.neverPaysOff && proj.months > 0 && (
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 400, marginTop: 2 }}>
                          Pays off in {Math.floor(proj.months / 12)}y {proj.months % 12}m · {formatCurrency(proj.totalInterest, l.currency)} interest
                        </div>
                      )}
                      {proj && proj.neverPaysOff && (
                        <div style={{ fontSize: 11, color: 'var(--loss)', fontWeight: 400, marginTop: 2 }}>
                          ⚠ Payment doesn't cover monthly interest
                        </div>
                      )}
                    </td>
                    <td><span className="badge badge-other">{TYPE_LABELS[l.type] || l.type}</span></td>
                    <td style={{ color: 'var(--text-muted)' }}>
                      {l.currency}
                      {l.interestRate != null && (
                        <div style={{ fontSize: 10, marginTop: 2 }}>{l.interestRate}% APR</div>
                      )}
                    </td>
                    <td className="text-right loss fw-600">
                      {formatCurrency(parseFloat(l.balance), l.currency)}
                      {l.monthlyPayment > 0 && (
                        <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 400, marginTop: 2 }}>
                          {formatCurrency(l.monthlyPayment, l.currency)}/mo
                        </div>
                      )}
                    </td>
                    <td className="text-right loss fw-600">
                      {l.currency !== cur ? formatCurrency(l.balanceBase, cur) : '—'}
                    </td>
                    <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{l.notes}</td>
                    <td>
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        <button className="btn btn-xs btn-secondary" title="Record payment or charge" onClick={() => setPaymentFor(l)}>
                          💳 Pay
                        </button>
                        <button className="btn btn-xs btn-ghost" onClick={() => { setEditingLiability(l); setShowModal(true) }}>✎</button>
                        <button className="btn btn-xs btn-danger" onClick={() => setConfirmDelete(l)}>✕</button>
                      </div>
                    </td>
                  </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {confirmDelete && (
        <div className="modal-backdrop">
          <div className="modal" style={{ maxWidth: 400 }}>
            <div className="modal-header">
              <span className="modal-title">Delete Liability</span>
              <button className="modal-close" onClick={() => setConfirmDelete(null)}>×</button>
            </div>
            <div className="modal-body">
              <p>Delete <strong>{confirmDelete.name}</strong>?</p>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setConfirmDelete(null)}>Cancel</button>
              <button className="btn btn-danger" onClick={() => { deleteLiability(confirmDelete.id); setConfirmDelete(null) }}>Delete</button>
            </div>
          </div>
        </div>
      )}

      {showModal && (
        <LiabilityModal
          liability={editingLiability || undefined}
          onClose={() => { setShowModal(false); setEditingLiability(null) }}
        />
      )}

      {/* Payment / charge modal */}
      {paymentFor && (
        <div className="modal-backdrop">
          <div className="modal" style={{ maxWidth: 460 }}>
            <div className="modal-header">
              <span className="modal-title">
                {paymentForm.type === 'payment' ? 'Record Payment' : 'Record Charge'} · {paymentFor.name}
              </span>
              <button className="modal-close" onClick={() => setPaymentFor(null)}>×</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>Action</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button type="button"
                    className={`btn btn-sm ${paymentForm.type === 'payment' ? 'btn-primary' : 'btn-secondary'}`}
                    onClick={() => setPaymentForm(f => ({ ...f, type: 'payment' }))}
                  >− Payment (reduces balance)</button>
                  <button type="button"
                    className={`btn btn-sm ${paymentForm.type === 'charge' ? 'btn-primary' : 'btn-secondary'}`}
                    onClick={() => setPaymentForm(f => ({ ...f, type: 'charge' }))}
                  >+ Charge (adds to balance)</button>
                </div>
              </div>
              <div className="form-row">
                <div className="form-group mb-0">
                  <label>Amount ({paymentFor.currency}) *</label>
                  <input type="number" step="any" min="0" autoFocus
                    value={paymentForm.amount}
                    onChange={e => setPaymentForm(f => ({ ...f, amount: e.target.value }))}
                    placeholder="0.00" />
                </div>
                <div className="form-group mb-0">
                  <label>Date *</label>
                  <input type="date"
                    value={paymentForm.date}
                    onChange={e => setPaymentForm(f => ({ ...f, date: e.target.value }))} />
                </div>
              </div>
              {paymentForm.type === 'payment' && cashAccounts.length > 0 && (
                <div className="form-group">
                  <label>Pay From (Cash &amp; Savings account)</label>
                  <select
                    value={paymentForm.sourceAssetId}
                    onChange={e => setPaymentForm(f => ({ ...f, sourceAssetId: e.target.value }))}
                  >
                    <option value="">— None (record balance change only) —</option>
                    {cashAccounts.map(a => (
                      <option key={a.id} value={a.id}>
                        {a.name} ({formatCurrency(a.currentValueNative, a.currency)})
                      </option>
                    ))}
                  </select>
                  <div className="form-hint">
                    Selecting an account also logs a withdrawal in its activity, so
                    cash flow stays in sync.
                  </div>
                </div>
              )}
              <div className="form-group mb-0">
                <label>Notes</label>
                <input value={paymentForm.notes}
                  onChange={e => setPaymentForm(f => ({ ...f, notes: e.target.value }))}
                  placeholder="e.g. Principal + interest, April" />
              </div>
              <div style={{ marginTop: 14, padding: 10, background: 'var(--surface)', borderRadius: 'var(--radius-sm)', fontSize: 12 }}>
                Current balance: <strong>{formatCurrency(parseFloat(paymentFor.balance) || 0, paymentFor.currency)}</strong>
                {paymentForm.amount && (
                  <div style={{ marginTop: 4, color: paymentForm.type === 'payment' ? 'var(--gain)' : 'var(--loss)' }}>
                    New balance: <strong>{formatCurrency(
                      paymentForm.type === 'payment'
                        ? Math.max(0, (parseFloat(paymentFor.balance) || 0) - (parseFloat(paymentForm.amount) || 0))
                        : (parseFloat(paymentFor.balance) || 0) + (parseFloat(paymentForm.amount) || 0),
                      paymentFor.currency
                    )}</strong>
                  </div>
                )}
              </div>

              {Array.isArray(paymentFor.history) && paymentFor.history.length > 0 && (
                <div style={{ marginTop: 14 }}>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6, fontWeight: 600 }}>
                    Recent history
                  </div>
                  <div style={{ maxHeight: 140, overflowY: 'auto', fontSize: 12 }}>
                    {paymentFor.history.slice(0, 6).map(h => (
                      <div key={h.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid var(--border)' }}>
                        <span style={{ color: 'var(--text-muted)' }}>{h.date}</span>
                        <span style={{ color: h.type === 'payment' ? 'var(--gain)' : 'var(--loss)' }}>
                          {h.type === 'payment' ? '−' : '+'}{formatCurrency(h.amount, paymentFor.currency)}
                        </span>
                        <span style={{ color: 'var(--text-muted)' }}>→ {formatCurrency(h.balanceAfter, paymentFor.currency)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setPaymentFor(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={applyPayment}>
                {paymentForm.type === 'payment' ? 'Record Payment' : 'Record Charge'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
