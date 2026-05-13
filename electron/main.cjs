'use strict'

const { app, BrowserWindow, shell } = require('electron')
const path = require('path')
const http = require('http')

const isDev = !app.isPackaged

let mainWindow

// Set env vars before the ESM server module is imported so it picks them up.
// PORTFOLIO_DATA_DIR  → where portfolio.json lives (OS user-data folder in prod)
// ELECTRON_PRODUCTION → tells server.js to serve dist/ as static files
async function startServer () {
  process.env.PORTFOLIO_DATA_DIR = app.getPath('userData')
  if (!isDev) process.env.ELECTRON_PRODUCTION = '1'
  // Dynamic import works from a CJS file and correctly handles the ESM server
  await import('../server.js')
}

// Poll the API until Express is accepting connections (max ~6 s)
function waitForServer (retries = 20, delay = 300) {
  return new Promise((resolve, reject) => {
    let attempts = 0
    const check = () => {
      const req = http.get('http://localhost:3001/api/data', res => {
        res.resume()
        resolve()
      })
      req.on('error', () => {
        if (++attempts >= retries) return reject(new Error('Server did not start in time'))
        setTimeout(check, delay)
      })
      req.end()
    }
    check()
  })
}

function createWindow () {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'Net Worth Tracker',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  })

  // Dev: load the Vite dev server (run `npm run dev` first)
  // Production: load the built app served by Express
  const url = isDev ? 'http://localhost:5173' : 'http://localhost:3001'
  mainWindow.loadURL(url)

  // Open <a target="_blank"> links in the system browser, not a new Electron window
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })
}

app.whenReady().then(async () => {
  // In production the server hasn't been started yet — start it here.
  // In dev the user runs `npm run dev` separately, so we skip this.
  if (!isDev) {
    await startServer()
    await waitForServer()
  }
  createWindow()
})

app.on('window-all-closed', () => {
  app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})
