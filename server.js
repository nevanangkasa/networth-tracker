import { createRequire } from 'module'
const require = createRequire(import.meta.url)

const express = require('express')
const fs = require('fs')
const fsp = require('fs').promises
const path = require('path')
const { fileURLToPath } = require('url')

const app = express()
app.use(express.json({ limit: '20mb' }))

const DATA_DIR = process.env.PORTFOLIO_DATA_DIR
  ? path.join(process.env.PORTFOLIO_DATA_DIR, 'networth-tracker')
  : path.join(process.cwd(), 'data')
const DATA_FILE = path.join(DATA_DIR, 'portfolio.json')

const DEFAULT_DATA = {
  assets: [],
  transactions: [],
  liabilities: [],
  snapshots: [],
  settings: {
    apiKey: '',
    baseCurrency: 'USD',
    autoRefresh: false,
    lastSnapshotDate: null
  },
  pricesCache: {},
  fxCache: {}
}

function ensureData() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true })
  }
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(DEFAULT_DATA, null, 2), 'utf-8')
    console.log('Created data/portfolio.json with default structure')
  }
}

app.get('/api/data', async (req, res) => {
  try {
    ensureData()
    const raw = await fsp.readFile(DATA_FILE, 'utf-8')
    const data = JSON.parse(raw)
    // Merge any missing top-level keys from DEFAULT_DATA
    const merged = { ...DEFAULT_DATA, ...data }
    res.json(merged)
  } catch (err) {
    console.error('Error reading data:', err)
    res.status(500).json({ error: 'Failed to read data file' })
  }
})

// Serialize concurrent saves so two near-simultaneous POSTs can't interleave
// each other's data on disk. Writes go to a temp file then rename — atomic on
// POSIX, near-atomic on Windows — so a crash mid-write can never leave a
// truncated portfolio.json that fails to parse on next load.
let writeChain = Promise.resolve()
async function atomicWrite(file, body) {
  // Async I/O so a 20 MB body (the express.json limit) doesn't block the
  // event loop and stall concurrent /api/price proxy requests.
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
  try {
    await fsp.writeFile(tmp, body, 'utf-8')
    await fsp.rename(tmp, file)
  } catch (err) {
    try { await fsp.unlink(tmp) } catch {/* ignore */}
    throw err
  }
}

app.post('/api/data', (req, res) => {
  ensureData()
  const body = JSON.stringify(req.body, null, 2)
  // Keep `writeChain` as the pure I/O sequence so a failure to send the
  // response (e.g. client disconnected) doesn't poison subsequent writes
  // or trigger "Cannot set headers after they are sent" double-replies.
  const myWrite = writeChain.then(() => atomicWrite(DATA_FILE, body))
  writeChain = myWrite.catch(() => {/* swallow so chain stays alive */})
  myWrite.then(
    () => { try { res.json({ ok: true }) } catch {/* socket gone */} },
    (err) => {
      console.error('Error writing data:', err)
      try { res.status(500).json({ error: 'Failed to write data file' }) } catch {/* socket gone */}
    }
  )
})

// Yahoo Finance price proxy (avoids browser CORS)
app.get('/api/price/:symbol', async (req, res) => {
  const { symbol } = req.params
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    })
    if (!response.ok) {
      return res.status(response.status).json({ error: `Yahoo returned ${response.status}` })
    }
    const json = await response.json()
    const price = json?.chart?.result?.[0]?.meta?.regularMarketPrice
    const currency = json?.chart?.result?.[0]?.meta?.currency || 'USD'
    if (!price) {
      return res.status(404).json({ error: 'No price data' })
    }
    res.json({ symbol, price, currency })
  } catch (err) {
    console.error('Price proxy error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// Yahoo Finance sector/industry proxy via the (public) search endpoint.
// The quoteSummary endpoint now requires an authenticated crumb; search does not.
app.get('/api/quote/:symbol', async (req, res) => {
  const { symbol } = req.params
  try {
    const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(symbol)}&quotesCount=5&newsCount=0`
    const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
    if (!response.ok) return res.status(response.status).json({ error: `Yahoo ${response.status}` })
    const json = await response.json()
    // Find an EQUITY match whose symbol matches (case-insensitive)
    const quotes = json?.quotes || []
    const match = quotes.find(q => q.symbol?.toUpperCase() === symbol.toUpperCase() && q.quoteType === 'EQUITY')
      || quotes.find(q => q.quoteType === 'EQUITY')
    if (!match) return res.status(404).json({ error: 'No sector data' })
    res.json({
      symbol,
      longName: match.longname || match.shortname || null,
      sector:   match.sector || match.sectorDisp || null,
      industry: match.industry || match.industryDisp || null,
      exchange: match.exchDisp || match.exchange || null,
    })
  } catch (err) {
    console.error('Quote proxy error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// Yahoo Finance symbol search proxy — works without an API key so the
// AssetModal ticker autocomplete is usable for everyone, not just users
// who entered a Twelve Data key.
app.get('/api/search/:query', async (req, res) => {
  const { query } = req.params
  try {
    const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=10&newsCount=0`
    const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
    if (!response.ok) return res.status(response.status).json({ error: `Yahoo ${response.status}` })
    const json = await response.json()
    const quotes = (json?.quotes || [])
      .filter(q => q.symbol)
      .slice(0, 10)
      .map(q => ({
        symbol: q.symbol,
        name: q.longname || q.shortname || q.symbol,
        exchange: q.exchDisp || q.exchange || '',
        country: q.exchange || '',
        // Yahoo doesn't return currency on the search endpoint; default to USD
        // and let users override on the Asset modal.
        currency: q.currency || 'USD',
        type: q.quoteType || '',
      }))
    res.json({ results: quotes })
  } catch (err) {
    console.error('Search proxy error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// Yahoo Finance FX proxy — e.g. /api/fx/USD/IDR returns { rate }
app.get('/api/fx/:from/:to', async (req, res) => {
  const { from, to } = req.params
  if (from === to) return res.json({ from, to, rate: 1 })
  try {
    const pair = `${from.toUpperCase()}${to.toUpperCase()}=X`
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(pair)}?interval=1d&range=1d`
    const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
    if (!response.ok) {
      return res.status(response.status).json({ error: `Yahoo returned ${response.status}` })
    }
    const json = await response.json()
    const rate = json?.chart?.result?.[0]?.meta?.regularMarketPrice
    if (!rate) return res.status(404).json({ error: 'No FX data' })
    res.json({ from, to, rate, source: 'yahoo' })
  } catch (err) {
    console.error('FX proxy error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// In packaged Electron builds the frontend is pre-built into dist/.
// Express serves it here so the app loads from http://localhost:3001 with no
// Vite dev server needed.
if (process.env.ELECTRON_PRODUCTION) {
  const __dirname = path.dirname(fileURLToPath(import.meta.url))
  const distPath = path.join(__dirname, 'dist')
  app.use(express.static(distPath))
  app.get('*', (req, res) => res.sendFile(path.join(distPath, 'index.html')))
}

// In Electron production mode use port 0 so the OS picks any free port,
// avoiding conflicts if the user has something else on 3001. Dev mode keeps
// 3001 so the Vite proxy config continues to work unchanged.
const PORT = process.env.ELECTRON_PRODUCTION ? 0 : 3001
ensureData()
// Bind to localhost only — this is a single-user local-first app and the data
// file has no auth. Binding to 0.0.0.0 would let anyone on the LAN read or
// overwrite the user's portfolio.
export const serverReady = new Promise((resolve, reject) => {
  const httpServer = app.listen(PORT, '127.0.0.1', () => {
    const port = httpServer.address().port
    console.log(`Portfolio API server running on http://localhost:${port}`)
    console.log(`Data file: ${DATA_FILE}`)
    resolve(port)
  })
  httpServer.on('error', reject)
})
