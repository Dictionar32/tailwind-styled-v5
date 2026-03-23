/**
 * tailwind-styled Studio Desktop — Electron main process
 *
 * Membungkus web studio (scripts/v45/studio.mjs) dalam Electron window.
 * Web studio berjalan sebagai background HTTP server, Electron load di BrowserWindow.
 *
 * Build: npm run build:studio (packages electron binary)
 * Dev:   npm run studio:dev (opens DevTools)
 *
 * Features vs Web Studio:
 *   + Native file picker (open project folder)
 *   + System tray integration
 *   + Auto-reload saat file berubah
 *   + Native menu bar
 *   + Keyboard shortcuts
 */

const { app, BrowserWindow, Menu, Tray, dialog, ipcMain, shell, nativeTheme } = require("electron")
const path = require("node:path")
const http = require("node:http")
const { spawn } = require("node:child_process")
const fs = require("node:fs")
const { setupAutoUpdater, checkForUpdatesManually } = require("./updater")

const STUDIO_PORT = Number(process.env.STUDIO_PORT ?? 3030)
const isDev = process.env.NODE_ENV === "development" || process.argv.includes("--dev")

// Resolve studio script — electron-builder bundles scripts ke process.resourcesPath
function resolveStudioScript() {
  const candidates = [
    // Packaged: electron-builder extraResources copies ke resources/
    process.resourcesPath ? path.join(process.resourcesPath, "scripts/v45/studio.mjs") : null,
    // Dev: monorepo root
    path.join(__dirname, "../../scripts/v45/studio.mjs"),
    // Fallback: cwd
    path.join(process.cwd(), "scripts/v45/studio.mjs"),
  ].filter(Boolean)

  return candidates.find((p) => fs.existsSync(p)) ?? candidates[1]
}

const STUDIO_SCRIPT = resolveStudioScript()

let mainWindow = null
let tray = null
let studioServer = null
let currentProject = process.argv.find((a) => a.startsWith("--project="))?.split("=")[1]
  ?? process.cwd()

// ─── Start studio server ───────────────────────────────────────────────────────

function startStudioServer(projectDir) {
  if (studioServer) {
    studioServer.kill("SIGTERM")
    studioServer = null
  }

  studioServer = spawn(process.execPath, [STUDIO_SCRIPT, `--project=${projectDir}`, `--port=${STUDIO_PORT}`], {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, PORT: String(STUDIO_PORT) },
  })

  studioServer.stdout?.on("data", (d) => {
    if (process.env.STUDIO_VERBOSE) process.stdout.write(d)
  })

  studioServer.stderr?.on("data", (d) => {
    if (process.env.STUDIO_VERBOSE) process.stderr.write(d)
  })

  studioServer.on("exit", (code) => {
    if (code !== 0 && code !== null) {
      console.warn(`[studio] server exited with code ${code}`)
    }
  })
}

// ─── Wait for server ready ─────────────────────────────────────────────────────

function waitForServer(url, maxMs = 8000) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + maxMs
    const attempt = () => {
      http
        .get(`${url}/health`, (res) => {
          if (res.statusCode === 200) resolve(undefined)
          else retry()
        })
        .on("error", retry)
    }
    const retry = () => {
      if (Date.now() > deadline) return reject(new Error("Server timeout"))
      setTimeout(attempt, 300)
    }
    attempt()
  })
}

// ─── Create main window ────────────────────────────────────────────────────────

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280, height: 800, minWidth: 900, minHeight: 600,
    title: "tailwind-styled Studio",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#0f172a" : "#f8fafc",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
    show: false,
  })

  mainWindow.once("ready-to-show", () => {
    mainWindow.show()
    if (isDev) mainWindow.webContents.openDevTools({ mode: "detach" })
  })

  mainWindow.on("closed", () => { mainWindow = null })

  // Start studio server for current project
  startStudioServer(currentProject)

  try {
    await waitForServer(`http://localhost:${STUDIO_PORT}`)
    mainWindow.loadURL(`http://localhost:${STUDIO_PORT}`)
  } catch {
    mainWindow.loadFile(path.join(__dirname, "loading-error.html"))
  }
}

// ─── Native menu ──────────────────────────────────────────────────────────────

function buildMenu() {
  const template = [
    ...(process.platform === "darwin" ? [{ role: "appMenu" }] : []),
    {
      label: "File",
      submenu: [
        {
          label: "Open Project…",
          accelerator: "CmdOrCtrl+O",
          async click() {
            const result = await dialog.showOpenDialog(mainWindow, {
              properties: ["openDirectory"],
              title: "Open project folder",
            })
            if (!result.canceled && result.filePaths[0]) {
              currentProject = result.filePaths[0]
              startStudioServer(currentProject)
              await waitForServer(`http://localhost:${STUDIO_PORT}`).catch(() => {})
              mainWindow?.loadURL(`http://localhost:${STUDIO_PORT}`)
            }
          },
        },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
        ...(isDev ? [{ role: "toggleDevTools" }] : []),
      ],
    },
    {
      label: "Tools",
      submenu: [
        {
          label: "Generate Component…",
          accelerator: "CmdOrCtrl+Shift+N",
          click() { mainWindow?.webContents.executeJavaScript("document.getElementById('ai-input')?.focus()") },
        },
        {
          label: "Split Route CSS",
          click() { mainWindow?.webContents.executeJavaScript("fetch('/api/split-routes',{method:'POST'})") },
        },
        { type: "separator" },
        {
          label: "Open in Browser",
          click() { shell.openExternal(`http://localhost:${STUDIO_PORT}`) },
        },
        { type: "separator" },
        {
          label: "Check for Updates…",
          click() { if (mainWindow) checkForUpdatesManually(mainWindow) },
        },
      ],
    },
    { role: "help", submenu: [{ label: "Documentation", click() { shell.openExternal("https://github.com/your-org/tailwind-styled-v4") } }] },
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template as Electron.MenuItemConstructorOptions[]))
}

// ─── System tray ──────────────────────────────────────────────────────────────

function createTray() {
  // Use bundled 16x16 icon asset
  const iconPath = path.join(__dirname, "icons", "tray.png")
  const iconExists = fs.existsSync(iconPath)

  if (!iconExists) {
    console.warn("[studio] Tray icon not found at", iconPath, "— skipping tray")
    return
  }

  try {
    tray = new Tray(iconPath)
    tray.setToolTip("tailwind-styled Studio")

    const contextMenu = Menu.buildFromTemplate([
      {
        label: "Open Studio",
        click() {
          if (mainWindow) { mainWindow.show(); mainWindow.focus() }
          else createWindow()
        },
      },
      {
        label: "Open in Browser",
        click() { shell.openExternal(`http://localhost:${STUDIO_PORT}`) },
      },
      { type: "separator" },
      {
        label: "Current Project",
        enabled: false,
        label: currentProject ? path.basename(currentProject) : "No project",
      },
      { type: "separator" },
      { label: "Quit", click() { app.quit() } },
    ])

    tray.setContextMenu(contextMenu)

    // Single click → show window
    tray.on("click", () => {
      if (mainWindow) {
        mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show()
      }
    })

    // Double click → focus window
    tray.on("double-click", () => {
      if (mainWindow) { mainWindow.show(); mainWindow.focus() }
    })

    console.log("[studio] System tray ready")
  } catch (e) {
    console.warn("[studio] Tray creation failed:", e.message)
  }
}

// ─── IPC handlers ─────────────────────────────────────────────────────────────

function setupIpc() {
  ipcMain.handle("get-project-path", () => currentProject)

  ipcMain.handle("open-file-picker", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ["openDirectory"],
      title: "Select project folder",
    })
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle("change-project", async (_event, projectPath) => {
    if (!fs.existsSync(projectPath)) return { ok: false, error: "Path not found" }
    currentProject = projectPath
    // Reset engine instance agar pakai project baru
    ipcMain.emit("engine-reset")
    startStudioServer(currentProject)
    try {
      await waitForServer(`http://localhost:${STUDIO_PORT}`)
      return { ok: true, url: `http://localhost:${STUDIO_PORT}` }
    } catch {
      return { ok: false, error: "Server failed to start" }
    }
  })

  // ── Engine IPC — scan, build, watch via @tailwind-styled/engine ──────────────

  /** Lazy-load engine untuk menghindari blocking startup */
  let _engine = null
  let _engineWatcher = null

  async function getEngine() {
    if (_engine) return _engine
    try {
      const { createEngine } = require("@tailwind-styled/engine")
      _engine = await createEngine({ root: currentProject })
      return _engine
    } catch (e) {
      throw new Error(`Engine unavailable: ${e.message}`)
    }
  }

  ipcMain.handle("engine-scan", async () => {
    try {
      const engine = await getEngine()
      const result = await engine.scan()
      return { ok: true, totalFiles: result.totalFiles, uniqueClasses: result.uniqueClasses.length }
    } catch (e) {
      return { ok: false, error: e.message }
    }
  })

  ipcMain.handle("engine-build", async () => {
    try {
      const engine = await getEngine()
      const result = await engine.build()
      return {
        ok: true,
        totalFiles: result.scan.totalFiles,
        uniqueClasses: result.scan.uniqueClasses.length,
        cssLength: result.css.length,
      }
    } catch (e) {
      return { ok: false, error: e.message }
    }
  })

  ipcMain.handle("engine-watch-start", async (_event, opts = {}) => {
    if (_engineWatcher) return { ok: true, status: "already-watching" }
    try {
      const engine = await getEngine()
      _engineWatcher = await engine.watch((event) => {
        // Forward engine events to renderer
        mainWindow?.webContents.send("engine-event", event)
      }, opts)
      return { ok: true, status: "watching" }
    } catch (e) {
      return { ok: false, error: e.message }
    }
  })

  ipcMain.handle("engine-watch-stop", () => {
    if (_engineWatcher) {
      _engineWatcher.close()
      _engineWatcher = null
    }
    return { ok: true }
  })

  // Reset engine saat project berubah
  ipcMain.on("engine-reset", () => {
    _engineWatcher?.close()
    _engineWatcher = null
    _engine = null
  })
}

// ─── App lifecycle ─────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  buildMenu()
  createTray()
  setupIpc()
  createWindow().then(() => {
    if (mainWindow) setupAutoUpdater(mainWindow)
  })

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit()
})

app.on("before-quit", () => {
  studioServer?.kill("SIGTERM")
})
