import React, { useState } from 'react'

// Clickable metric card that opens an explanation modal showing:
//   - what the metric means in plain English
//   - the formula
//   - the actual numbers used in the calculation right now
//   - how to interpret the value (with thresholds where relevant)
//
// Used on the Dashboard's Financial Health card to demystify each KPI so
// users understand what they're looking at instead of just seeing numbers.
export default function ExplainMetric({
  label,         // metric short label, e.g. "Emergency Fund"
  value,         // primary value text, e.g. "5.2 mo"
  valueClass,    // 'gain' | 'loss' | 'accent' | undefined
  sub,           // sub-label
  explanation,   // longer plain-English explanation
  formula,       // string formula, e.g. "Liquid cash ÷ Monthly expenses"
  inputs,        // array of { label, value } showing the actual numbers
  interpretation,// optional ranges/advice, e.g. [{ band: '≥6mo', label: 'Healthy', cls: 'gain' }, ...]
}) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <div
        onClick={() => setOpen(true)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(true) } }}
        title="Click to see how this is calculated"
        style={{ cursor: 'pointer', position: 'relative', borderRadius: 4, padding: 4, margin: -4 }}
        onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-secondary)' }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
      >
        <div className="metric-label" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          {label}
          <span
            aria-hidden="true"
            style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              width: 14, height: 14, borderRadius: '50%',
              border: '1px solid var(--text-muted)',
              fontSize: 9, fontWeight: 700, color: 'var(--text-muted)',
              fontStyle: 'italic',
            }}
          >i</span>
        </div>
        <div className={`metric-value ${valueClass || ''}`}>{value}</div>
        {sub && <div className="metric-sub">{sub}</div>}
      </div>

      {open && (
        <div className="modal-backdrop" onClick={() => setOpen(false)} style={{ zIndex: 110 }}>
          <div className="modal" style={{ maxWidth: 480 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">{label}</span>
              <button className="modal-close" onClick={() => setOpen(false)}>×</button>
            </div>
            <div className="modal-body">
              <div style={{
                fontSize: 28, fontWeight: 700, marginBottom: 8,
              }} className={valueClass || ''}>{value}</div>
              {sub && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 14 }}>{sub}</div>}

              <div style={{ fontSize: 13, lineHeight: 1.6, marginBottom: 16 }}>
                {explanation}
              </div>

              {formula && (
                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)',
                    textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>
                    Formula
                  </div>
                  <div style={{
                    background: 'var(--bg-secondary)', padding: '8px 10px', borderRadius: 4,
                    fontFamily: 'ui-monospace, monospace', fontSize: 12,
                  }}>
                    {formula}
                  </div>
                </div>
              )}

              {inputs && inputs.length > 0 && (
                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)',
                    textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>
                    Your numbers
                  </div>
                  <table style={{ width: '100%', fontSize: 13 }}>
                    <tbody>
                      {inputs.map((row, i) => (
                        <tr key={i}>
                          <td style={{ padding: '4px 0', color: 'var(--text-muted)' }}>{row.label}</td>
                          <td style={{ padding: '4px 0', textAlign: 'right', fontWeight: 600,
                            fontVariantNumeric: 'tabular-nums' }}>
                            {row.value}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {interpretation && interpretation.length > 0 && (
                <div>
                  <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)',
                    textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>
                    What it means
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {interpretation.map((row, i) => (
                      <div key={i} style={{
                        display: 'flex', alignItems: 'center', gap: 8,
                        padding: '6px 8px', borderRadius: 4,
                        background: row.active ? 'var(--bg-secondary)' : 'transparent',
                        border: row.active ? '1px solid var(--accent)' : '1px solid transparent',
                      }}>
                        <span className={row.cls || ''} style={{ fontWeight: 700, fontSize: 12, minWidth: 70 }}>
                          {row.band}
                        </span>
                        <span style={{ fontSize: 12, flex: 1 }}>{row.label}</span>
                        {row.active && <span style={{ fontSize: 11, color: 'var(--accent)', fontWeight: 600 }}>← you</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
