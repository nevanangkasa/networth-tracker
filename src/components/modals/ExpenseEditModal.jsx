import React, { useState, useMemo } from 'react'
import { usePortfolio } from '../../context/PortfolioContext.jsx'
import { CURRENCIES, todayISO, formatCurrency } from '../../utils/calculations.js'
import ToggleTile from '../ToggleTile.jsx'

// Self-contained Add/Edit modal for recurring expenses. Used by both the
// Expenses page and the Planning page so an edit ✎ can stay on whichever
// page the user opened it from — no navigation needed.
//
// Props:
//   expense: existing expense object (edit mode) or null (add mode)
//   onClose: required handler — fires after save or cancel
//   onSaved: optional callback invoked AFTER a successful save with the
//            saved/updated expense (lets callers refresh local state if needed)

const RECURRENCE = [
  { value: 'one_time', label: 'One-time' },
  { value: 'weekly',   label: 'Weekly'   },
  { value: 'monthly',  label: 'Monthly'  },
  { value: 'yearly',   label: 'Yearly'   },
]

const DEFAULT_CATEGORIES = [
  'Food & Dining', 'Housing', 'Transport', 'Utilities',
  'Entertainment', 'Healthcare', 'Shopping', 'Education',
  'Insurance', 'Subscriptions', 'Travel', 'Taxes', 'Other',
]

const EMPTY_FORM = {
  name: '', amount: '', currency: 'USD',
  category: 'Food & Dining', tags: [],
  recurrence: 'monthly',
  startDate: todayISO(), endDate: '',
  sources: [], // [{ assetId, percent }]
  notes: '',
}

function normalizeSources(exp) {
  if (Array.isArray(exp?.sources) && exp.sources.length) {
    return exp.sources.map(s => ({ assetId: s.assetId, percent: Number(s.percent) || 0 }))
  }
  const ids = exp?.sourceAssetIds || []
  if (!ids.length) return []
  const even = Math.round((100 / ids.length) * 100) / 100
  return ids.map((id, i) => ({
    assetId: id,
    percent: i === ids.length - 1 ? Math.round((100 - even * (ids.length - 1)) * 100) / 100 : even,
  }))
}

function evenSplit(sources) {
  if (!sources.length) return []
  const each = Math.floor((100 / sources.length) * 100) / 100
  const last = Math.round((100 - each * (sources.length - 1)) * 100) / 100
  return sources.map((s, i) => ({
    assetId: s.assetId,
    percent: i === sources.length - 1 ? last : each,
  }))
}

export default function ExpenseEditModal({ expense, onClose, onSaved }) {
  const { data, holdings, addExpense, editExpense, addExpenseCategory } = usePortfolio()
  const isEdit = !!expense
  const cur = data.settings.baseCurrency

  const [form, setForm] = useState(() => {
    if (expense) {
      return {
        ...EMPTY_FORM,
        ...expense,
        tags: expense.tags || [],
        sources: normalizeSources(expense),
        endDate: expense.endDate || '',
      }
    }
    return { ...EMPTY_FORM, currency: cur, startDate: todayISO() }
  })
  const [tagInput, setTagInput] = useState('')
  const [newCategory, setNewCategory] = useState('')

  const cashAssets = holdings.filter(h => h.class === 'cash')
  const customCategories = data.expenseCategories || []
  const allCategories = useMemo(
    () => [...new Set([...DEFAULT_CATEGORIES, ...customCategories])],
    [customCategories]
  )
  const allUsedTags = useMemo(() => {
    const s = new Set()
    for (const e of (data.expenses || [])) (e.tags || []).forEach(t => s.add(t))
    return [...s].sort()
  }, [data.expenses])

  const sourcesTotal = (form.sources || []).reduce((s, x) => s + (Number(x.percent) || 0), 0)

  function submit(e) {
    e.preventDefault()
    if (!form.name.trim() || !parseFloat(form.amount)) return
    // Validate endDate ≥ startDate so users don't accidentally save a
    // never-occurring expense (the forecast loop would treat the range as
    // empty and silently drop it).
    if (form.endDate && form.startDate && form.endDate < form.startDate) {
      alert('End date must be on or after the start date.')
      return
    }
    // Validate multi-source split sums to 100% so the cash withdrawals
    // ExpenseContext auto-generates actually cover the full expense. With a
    // single source we coerce it to 100 below — the UI hides the percent
    // input for single-source expenses anyway.
    if (form.sources.length > 1) {
      const total = (form.sources || []).reduce((s, x) => s + (Number(x.percent) || 0), 0)
      if (Math.abs(total - 100) > 0.01) {
        alert(`Source percentages must sum to 100% (currently ${total.toFixed(2)}%). Use "Split evenly" or adjust manually.`)
        return
      }
    }
    const normalizedSources = form.sources.length === 1
      ? [{ assetId: form.sources[0].assetId, percent: 100 }]
      : form.sources.map(s => ({ assetId: s.assetId, percent: Number(s.percent) || 0 }))
    const payload = {
      name: form.name.trim(),
      amount: parseFloat(form.amount) || 0,
      currency: form.currency,
      category: form.category,
      tags: form.tags.map(t => t.trim().toLowerCase()).filter(Boolean),
      recurrence: form.recurrence,
      startDate: form.startDate || todayISO(),
      endDate: form.endDate || '',
      sources: normalizedSources,
      sourceAssetIds: normalizedSources.map(s => s.assetId),
      notes: form.notes.trim(),
    }
    if (isEdit) {
      editExpense(expense.id, payload)
      onSaved?.({ ...expense, ...payload })
    } else {
      addExpense(payload)
      onSaved?.(payload)
    }
    onClose()
  }

  function addTagFromInput() {
    const t = tagInput.trim().toLowerCase()
    if (!t) return
    if (!form.tags.includes(t)) setForm(f => ({ ...f, tags: [...f.tags, t] }))
    setTagInput('')
  }

  function addNewCategory() {
    const t = newCategory.trim()
    if (!t) return
    addExpenseCategory(t)
    setForm(f => ({ ...f, category: t }))
    setNewCategory('')
  }

  function toggleSourceAsset(id) {
    setForm(f => {
      const exists = (f.sources || []).some(s => s.assetId === id)
      const next = exists
        ? f.sources.filter(s => s.assetId !== id)
        : [...(f.sources || []), { assetId: id, percent: 0 }]
      return { ...f, sources: evenSplit(next) }
    })
  }
  function setSourcePercent(id, percent) {
    setForm(f => ({
      ...f,
      sources: f.sources.map(s => s.assetId === id ? { ...s, percent: Number(percent) || 0 } : s),
    }))
  }
  function applyEvenSplit() {
    setForm(f => ({ ...f, sources: evenSplit(f.sources) }))
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 560 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">{isEdit ? 'Edit Expense' : 'Add Expense'}</span>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <form onSubmit={submit}>
          <div className="modal-body">
            <div className="form-group">
              <label>Name *</label>
              <input
                value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Rent, Netflix, Gym…" required autoFocus
              />
            </div>
            <div className="form-row">
              <div className="form-group mb-0">
                <label>Amount *</label>
                <input
                  type="number" step="any" min="0"
                  value={form.amount}
                  onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
                  placeholder="0.00" required
                />
              </div>
              <div className="form-group mb-0">
                <label>Currency</label>
                <select value={form.currency} onChange={e => setForm(f => ({ ...f, currency: e.target.value }))}>
                  {CURRENCIES.map(c => <option key={c}>{c}</option>)}
                </select>
              </div>
              <div className="form-group mb-0">
                <label>Recurrence</label>
                <select value={form.recurrence} onChange={e => setForm(f => ({ ...f, recurrence: e.target.value }))}>
                  {RECURRENCE.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
              </div>
            </div>
            <div className="form-row">
              <div className="form-group mb-0">
                <label>Start Date *</label>
                <input type="date" value={form.startDate}
                  onChange={e => setForm(f => ({ ...f, startDate: e.target.value }))} required />
              </div>
              <div className="form-group mb-0">
                <label>End Date {form.recurrence === 'one_time' ? '' : '(optional)'}</label>
                <input type="date" value={form.endDate}
                  onChange={e => setForm(f => ({ ...f, endDate: e.target.value }))} />
              </div>
            </div>
            <div className="form-group">
              <label>Category</label>
              <div style={{ display: 'flex', gap: 6 }}>
                <select
                  value={form.category}
                  onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
                  style={{ flex: 1 }}
                >
                  {allCategories.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                <input
                  value={newCategory}
                  onChange={e => setNewCategory(e.target.value)}
                  placeholder="+ Add custom category"
                  style={{ flex: 1 }}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addNewCategory() } }}
                />
                <button type="button" className="btn btn-secondary btn-sm" onClick={addNewCategory} disabled={!newCategory.trim()}>
                  Add
                </button>
              </div>
            </div>
            <div className="form-group">
              <label>Tags</label>
              <div className="tags-input-wrap">
                {form.tags.map(t => (
                  <span key={t} className="tag-chip">
                    {t}
                    <button type="button" onClick={() => setForm(f => ({ ...f, tags: f.tags.filter(x => x !== t) }))}>×</button>
                  </span>
                ))}
                <input
                  value={tagInput}
                  onChange={e => setTagInput(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTagFromInput() }
                  }}
                  placeholder="e.g. essential, subscription…"
                />
              </div>
              {allUsedTags.length > 0 && (
                <div style={{ marginTop: 6, fontSize: 11, color: 'var(--text-muted)' }}>
                  Recently used: {allUsedTags.slice(0, 8).map(t => (
                    <button key={t} type="button" className="btn btn-xs btn-ghost"
                      style={{ marginLeft: 4, marginTop: 2 }}
                      onClick={() => { if (!form.tags.includes(t)) setForm(f => ({ ...f, tags: [...f.tags, t] })) }}
                    >#{t}</button>
                  ))}
                </div>
              )}
            </div>
            <div className="form-group">
              <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span>Paid from (Cash &amp; Savings accounts)</span>
                {form.sources.length > 1 && (
                  <button type="button" className="btn btn-xs btn-ghost" onClick={applyEvenSplit}>
                    Split evenly
                  </button>
                )}
              </label>
              {cashAssets.length === 0 ? (
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  No cash accounts yet. Add one on the Cash &amp; Savings page to link this expense.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {cashAssets.map(a => {
                    const src = form.sources.find(s => s.assetId === a.id)
                    const checked = !!src
                    return (
                      <ToggleTile
                        key={a.id}
                        checked={checked}
                        onChange={() => toggleSourceAsset(a.id)}
                      >
                        <span className="tile-toggle-label">
                          {a.name}
                          <span className="tile-toggle-meta" style={{ marginLeft: 6 }}>
                            · {formatCurrency(a.currentValueNative, a.currency)}
                          </span>
                        </span>
                        {checked && form.sources.length > 1 && (
                          <div
                            style={{ display: 'flex', alignItems: 'center', gap: 4 }}
                            onClick={e => e.stopPropagation()}
                          >
                            <input
                              type="number" min="0" max="100" step="0.01"
                              value={src.percent}
                              onChange={e => setSourcePercent(a.id, e.target.value)}
                              style={{ width: 72, padding: '4px 6px', fontSize: 12 }}
                            />
                            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>%</span>
                          </div>
                        )}
                      </ToggleTile>
                    )
                  })}
                </div>
              )}
              {form.sources.length > 1 && (
                <div
                  className="form-hint"
                  style={{ color: Math.abs(sourcesTotal - 100) < 0.01 ? 'var(--text-muted)' : 'var(--loss)' }}
                >
                  Total: {sourcesTotal.toFixed(2)}% {Math.abs(sourcesTotal - 100) < 0.01 ? '✓' : '(must equal 100%)'}
                </div>
              )}
              {form.sources.length <= 1 && (
                <div className="form-hint">Tick multiple accounts to split (e.g. 50/50 or custom %).</div>
              )}
            </div>
            <div className="form-group mb-0">
              <label>Notes</label>
              <input value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                placeholder="Optional" />
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary">
              {isEdit ? 'Save Changes' : 'Add Expense'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
