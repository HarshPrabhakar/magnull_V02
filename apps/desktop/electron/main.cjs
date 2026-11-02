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

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    title: "Mag-Null",
    backgroundColor: "#10141c",
    webPreferences: {
      preload: path.join(__dirname, "../preload/preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  const devServerUrl = process.env.MAGNULL_DEV_SERVER_URL;

  if (devServerUrl) {
    mainWindow.loadURL(devServerUrl);
  } else {
    mainWindow.loadFile(
      path.join(__dirname, "../frontend/dist/index.html")
    );
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
