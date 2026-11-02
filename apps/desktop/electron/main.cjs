const { app, BrowserWindow } = require("electron");
const path = require("node:path");
const { spawn } = require("node:child_process");
const fs = require("node:fs");

const BACKEND_URL = "http://127.0.0.1:8765";
const REPO_ROOT = path.resolve(__dirname, "../../..");
const BACKEND_DIR = process.env.MAGNULL_BACKEND_DIR || path.join(REPO_ROOT, "services", "backend");
const LOCAL_PYTHON = path.join(REPO_ROOT, ".venv", "Scripts", "python.exe");

let backendProcess = null;
let ownsBackendProcess = false;

async function requestBackend(pathname) {
  return fetch(`${BACKEND_URL}${pathname}`, { signal: AbortSignal.timeout(750) });
}

async function backendSnapshotReady() {
  try {
    return (await requestBackend("/api/v1/open-world/snapshot")).ok;
  } catch {
    return false;
  }
}

function startBackendProcess() {
  const python = process.env.MAGNULL_PYTHON || (fs.existsSync(LOCAL_PYTHON) ? LOCAL_PYTHON : "python");
  backendProcess = spawn(
    python,
    ["-m", "uvicorn", "api.main:app", "--host", "127.0.0.1", "--port", "8765"],
    { cwd: BACKEND_DIR, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
  );
  ownsBackendProcess = true;
  backendProcess.stdout.on("data", (data) => console.log(`[backend] ${data.toString().trimEnd()}`));
  backendProcess.stderr.on("data", (data) => console.error(`[backend] ${data.toString().trimEnd()}`));
  backendProcess.on("error", (error) => console.error("Unable to start the Mag-Null backend", error));
  backendProcess.on("exit", (code, signal) => {
    if (ownsBackendProcess && !app.isQuitting) {
      console.error(`Mag-Null backend exited (code ${code ?? "—"}, signal ${signal ?? "—"})`);
    }
  });
}

async function ensureBackendReady() {
  try {
    const health = await requestBackend("/health");
    if (health.ok) {
      if (await backendSnapshotReady()) return;
      throw new Error("A backend is already using port 8765 but does not provide the current Open World API. Stop that backend and restart Mag-Null.");
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("A backend is already")) throw error;
  }

  if (!fs.existsSync(BACKEND_DIR)) throw new Error(`Mag-Null backend directory not found: ${BACKEND_DIR}`);
  startBackendProcess();

  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (backendProcess.exitCode !== null) {
      throw new Error("The Mag-Null backend stopped during startup. Check the Electron console for its Python error.");
    }
    if (await backendSnapshotReady()) {
      console.log("Mag-Null backend is ready");
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error("Mag-Null backend did not become ready within 15 seconds. Check that the local Python environment has the locked requirements installed.");
}

function showRendererError(mainWindow, message) {
  if (mainWindow.isDestroyed()) return;

  const safeMessage = String(message).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
  const errorPage = `<!doctype html><html><head><meta charset="utf-8"><title>Mag-Null could not load</title><style>
    *{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#03060b;color:#c5d5df;font:14px Consolas,"Courier New",monospace}
    main{width:min(680px,calc(100% - 40px));padding:28px;background:#070d16;border:1px solid #345064;box-shadow:0 18px 60px #0008}
    h1{margin:0 0 12px;color:#00d8aa;font-size:18px;letter-spacing:1px}p{line-height:1.6}pre{padding:12px;background:#03060b;border:1px solid #203244;color:#e3af83;white-space:pre-wrap;overflow-wrap:anywhere}
    button{padding:9px 14px;background:#08201f;border:1px solid #00a98f;color:#8ce3cf;font:inherit;cursor:pointer}
  </style></head><body><main><h1>MAG-NULL DASHBOARD COULD NOT LOAD</h1><p>The desktop window opened, but its interface did not finish loading. Retry the page, or restart Mag-Null if the problem continues.</p><pre>${safeMessage}</pre><button onclick="location.reload()">RETRY DASHBOARD</button></main></body></html>`;

  console.error("Mag-Null renderer failed", message);
  void mainWindow.loadURL(`data:text/html;charset=UTF-8,${encodeURIComponent(errorPage)}`);
  if (!mainWindow.isVisible()) mainWindow.show();
}

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    title: "Mag-Null",
    backgroundColor: "#10141c",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "../preload/preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.webContents.on("console-message", (details) => {
    if (details.level === "error") console.error(`[renderer] ${details.message}`);
  });
  mainWindow.webContents.on("did-fail-load", (_event, errorCode, description, url, isMainFrame) => {
    if (isMainFrame && errorCode !== -3 && !url.startsWith("data:")) {
      showRendererError(mainWindow, `${description} (${errorCode})\n${url}`);
    }
  });
  mainWindow.webContents.on("render-process-gone", (_event, _contents, details) => {
    showRendererError(mainWindow, `Renderer stopped: ${details.reason} (exit code ${details.exitCode})`);
  });

  const devServerUrl = process.env.MAGNULL_DEV_SERVER_URL;

  if (devServerUrl) {
    void mainWindow.loadURL(devServerUrl).catch((error) => showRendererError(mainWindow, error.message));
  } else {
    void mainWindow.loadFile(path.join(__dirname, "../frontend/dist/index.html"))
      .catch((error) => showRendererError(mainWindow, error.message));
  }
}

app.whenReady().then(() => {
  createWindow();
  void ensureBackendReady().catch((error) => {
    console.error("Mag-Null could not connect to its simulation backend", error);
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  app.isQuitting = true;
  if (ownsBackendProcess && backendProcess && backendProcess.exitCode === null) {
    backendProcess.kill();
  }
});
