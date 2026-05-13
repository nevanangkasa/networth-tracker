import React, { useState, useMemo } from 'react'
import { usePortfolio } from '../../context/PortfolioContext.jsx'
import {
  CURRENCIES, todayISO, formatCurrency,
  amortizationSchedule, suggestPaymentForTerm,
} from '../../utils/calculations.js'

const TYPES = [
  { value: 'mortgage',   label: 'Mortgage' },
  { value: 'loan',       label: 'Personal / Auto Loan' },
  { value: 'credit',     label: 'Credit Card' },
  { value: 'business',   label: 'Business Loan' },
  { value: 'other',      label: 'Other' },
]

const DEFAULTS = {
  name: '', type: 'mortgage', balance: '', currency: 'USD',
  startDate: todayISO(), notes: '',
  // Optional planning fields — when present the Liabilities page can show a
  // payoff projection, total interest, and a balance-over-time chart.
  interestRate: '', monthlyPayment: '',
}

export default function LiabilityModal({ liability, onClose }) {
  const { addLiability, editLiability } = usePortfolio()
  const isEdit = !!liability
  const [form, setForm] = useState(isEdit ? { ...DEFAULTS, ...liability } : DEFAULTS)

  function set(k, v) { setForm(f => ({ ...f, [k]: v })) }

  function handleSubmit(e) {
    e.preventDefault()
    const payload = {
      name: form.name.trim(),
      type: form.type,
      balance: parseFloat(form.balance) || 0,
      currency: form.currency,
      startDate: form.startDate || '',
      notes: form.notes.trim(),
    }
    if (form.interestRate !== '' && !isNaN(parseFloat(form.interestRate))) {
      payload.interestRate = parseFloat(form.interestRate)
    }
    if (form.monthlyPayment !== '' && !isNaN(parseFloat(form.monthlyPayment))) {
      payload.monthlyPayment = parseFloat(form.monthlyPayment)
    }
    if (isEdit) editLiability(liability.id, payload)
    else addLiability(payload)
    onClose()
  }

  // Live amortization preview as user types
  const preview = useMemo(() => {
    const P = parseFloat(form.balance) || 0
    const r = parseFloat(form.interestRate) || 0
    const m = parseFloat(form.monthlyPayment) || 0
    if (P <= 0) return null
    if (r === 0 && m === 0) return null
    return amortizationSchedule(P, r, m)
  }, [form.balance, form.interestRate, form.monthlyPayment])

  return (
    <div className="modal-backdrop">
      <div className="modal">
        <div className="modal-header">
          <span className="modal-title">{isEdit ? 'Edit Liability' : 'Add Liability'}</span>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <div className="form-group">
              <label>Name *</label>
              <input
                value={form.name} onChange={e => set('name', e.target.value)}
                placeholder="e.g. Home Mortgage, Car Loan…" required autoFocus
              />
            </div>
            <div className="form-row">
              <div className="form-group mb-0">
                <label>Type</label>
                <select value={form.type} onChange={e => set('type', e.target.value)}>
                  {TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
              <div className="form-group mb-0">
                <label>Currency</label>
                <select value={form.currency} onChange={e => set('currency', e.target.value)}>
                  {CURRENCIES.map(c => <option key={c}>{c}</option>)}
                </select>
              </div>
            </div>
            <div className="form-row">
              <div className="form-group mb-0">
                <label>Outstanding Balance ({form.currency}) *</label>
                <input
                  type="number" step="any" min="0"
                  value={form.balance} onChange={e => set('balance', e.target.value)}
                  placeholder="0.00" required
                />
              </div>
              <div className="form-group mb-0">
                <label>Start Date</label>
                <input
                  type="date"
                  value={form.startDate || ''}
                  onChange={e => set('startDate', e.target.value)}
                />
              </div>
            </div>
            {/* Optional planning fields — power the payoff projection */}
            <div className="form-row">
              <div className="form-group mb-0">
                <label>Interest Rate (% APR) <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(optional)</span></label>
                <input
                  type="number" step="any" min="0" max="100"
                  value={form.interestRate}
                  onChange={e => set('interestRate', e.target.value)}
                  placeholder="e.g. 6.5"
                />
              </div>
              <div className="form-group mb-0">
                <label>Monthly Payment ({form.currency}) <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(optional)</span></label>
                <input
                  type="number" step="any" min="0"
                  value={form.monthlyPayment}
                  onChange={e => set('monthlyPayment', e.target.value)}
                  placeholder="e.g. 1850"
                />
              </div>
            </div>
            {/* Quick fill: standard 15/30 year mortgage payment for the entered balance + rate */}
            {form.balance && form.interestRate && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: -6, marginBottom: 12 }}>
                {[15, 30].map(years => {
                  const m = suggestPaymentForTerm(parseFloat(form.balance), parseFloat(form.interestRate), years)
                  if (!m || !isFinite(m)) return null
                  return (
                    <button
                      key={years}
                      type="button"
                      className="btn btn-xs btn-ghost"
                      onClick={() => set('monthlyPayment', m.toFixed(2))}
                      title={`Pays off in ${years} years`}
                    >
                      Use {years}-yr: {formatCurrency(m, form.currency)}/mo
                    </button>
                  )
                })}
              </div>
            )}

            {/* Live payoff projection */}
            {preview && (
              <div style={{
                background: 'var(--bg-secondary)', padding: 12, borderRadius: 6,
                fontSize: 12, marginBottom: 12,
              }}>
                <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
                  Payoff Projection
                </div>
                {preview.neverPaysOff ? (
                  <div style={{ color: 'var(--loss)' }}>
                    ⚠ Payment of {formatCurrency(parseFloat(form.monthlyPayment) || 0, form.currency)}/mo doesn't
                    cover monthly interest. Loan would never pay off.
                  </div>
                ) : (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                    <div>
                      <div style={{ color: 'var(--text-muted)', fontSize: 10 }}>Payoff in</div>
                      <div style={{ fontWeight: 700 }}>
                        {Math.floor(preview.months / 12)}y {preview.months % 12}m
                      </div>
                    </div>
                    <div>
                      <div style={{ color: 'var(--text-muted)', fontSize: 10 }}>Total interest</div>
                      <div style={{ fontWeight: 700, color: 'var(--loss)' }}>
                        {formatCurrency(preview.totalInterest, form.currency)}
                      </div>
                    </div>
                    <div>
                      <div style={{ color: 'var(--text-muted)', fontSize: 10 }}>Total paid</div>
                      <div style={{ fontWeight: 700 }}>
                        {formatCurrency(preview.totalPaid, form.currency)}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="form-group mb-0">
              <label>Notes</label>
              <textarea
                value={form.notes} onChange={e => set('notes', e.target.value)}
                placeholder="Lender, terms, etc." rows={2}
              />
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary">
              {isEdit ? 'Save Changes' : 'Add Liability'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
