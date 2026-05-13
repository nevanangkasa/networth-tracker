import React, { useState, lazy, Suspense } from 'react'
import { PortfolioProvider } from './context/PortfolioContext.jsx'
import Sidebar from './components/Sidebar.jsx'
import Dashboard from './components/Dashboard.jsx'
import UndoToast from './components/UndoToast.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import OnboardingModal from './components/OnboardingModal.jsx'
import BackupReminder from './components/BackupReminder.jsx'

// Lazy-load every page except Dashboard so the initial bundle (which used to
// be ~600KB minified) is much smaller. Each page only loads when the user
// navigates to it. Chart.js + react-chartjs-2 (the heaviest dep) gets pulled
// in by the first chart-using page that loads.
const Holdings        = lazy(() => import('./components/Holdings.jsx'))
const Stocks          = lazy(() => import('./components/Stocks.jsx'))
const Transactions    = lazy(() => import('./components/Transactions.jsx'))
const Property        = lazy(() => import('./components/Property.jsx'))
const CashSavings     = lazy(() => import('./components/CashSavings.jsx'))
const Income          = lazy(() => import('./components/Income.jsx'))
const Expenses        = lazy(() => import('./components/Expenses.jsx'))
const Liabilities     = lazy(() => import('./components/Liabilities.jsx'))
const NetWorthHistory = lazy(() => import('./components/NetWorthHistory.jsx'))
const Realized        = lazy(() => import('./components/Realized.jsx'))
const Reports         = lazy(() => import('./components/Reports.jsx'))
const Planning        = lazy(() => import('./components/Planning.jsx'))
const Settings        = lazy(() => import('./components/Settings.jsx'))

const SECTIONS = {
  dashboard: Dashboard,
  holdings: Holdings,
  stocks: Stocks,
  transactions: Transactions,
  property: Property,
  cash: CashSavings,
  income: Income,
  expenses: Expenses,
  liabilities: Liabilities,
  history: NetWorthHistory,
  realized: Realized,
  reports: Reports,
  planning: Planning,
  settings: Settings,
}

function PageFallback() {
  return (
    <div style={{ padding: 60, textAlign: 'center' }}>
      <div className="spinner" style={{ width: 24, height: 24, margin: '0 auto' }} />
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 12 }}>Loading…</div>
    </div>
  )
}

export default function App() {
  const [activeSection, setActiveSection] = useState('dashboard')
  const [navContext, setNavContext] = useState({}) // { from?: section, filterClass?: string, ... }
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)

  const ActiveComponent = SECTIONS[activeSection] || Dashboard

  // navigate(section) — straight nav; navigate(section, { from, filterClass })
  // — page can pre-filter or use `from` for a contextual "back" button.
  function navigate(section, ctx = {}) {
    setActiveSection(section)
    setNavContext(ctx)
    setMobileSidebarOpen(false)
  }

  return (
    <ErrorBoundary>
    <PortfolioProvider>
      <OnboardingModal />
      <div className="app-layout">
        <Sidebar
          active={activeSection}
          onNavigate={navigate}
          collapsed={sidebarCollapsed}
          onToggleCollapse={() => setSidebarCollapsed(c => !c)}
          mobileOpen={mobileSidebarOpen}
          onMobileClose={() => setMobileSidebarOpen(false)}
        />
        {mobileSidebarOpen && (
          <div
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 150 }}
            onClick={() => setMobileSidebarOpen(false)}
          />
        )}
        <button
          className="mobile-menu-btn"
          onClick={() => setMobileSidebarOpen(true)}
          aria-label="Open menu"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M3 6h18M3 12h18M3 18h18" />
          </svg>
        </button>
        <main className="main-content">
          <Suspense fallback={<PageFallback />}>
            <ActiveComponent
              onNavigate={navigate}
              navContext={navContext}
              onOpenMobileSidebar={() => setMobileSidebarOpen(true)}
            />
          </Suspense>
        </main>
        <UndoToast />
        <BackupReminder />
      </div>
    </PortfolioProvider>
    </ErrorBoundary>
  )
}
