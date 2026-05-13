import React from 'react'
import { usePortfolio } from '../context/PortfolioContext.jsx'
import { CURRENCIES } from '../utils/calculations.js'

/**
 * Small inline currency switcher for page headers.
 * Writes to `data.settings.baseCurrency` so every page re-renders in the chosen currency.
 */
export default function CurrencyToggle({ compact = false }) {
  const { data, updateSettings } = usePortfolio()
  const cur = data.settings.baseCurrency

  return (
    <div className="currency-toggle" title="Change display currency">
      {!compact && <span className="currency-toggle-label">Currency</span>}
      <select
        value={cur}
        onChange={e => updateSettings({ baseCurrency: e.target.value })}
        aria-label="Display currency"
      >
        {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
      </select>
    </div>
  )
}
