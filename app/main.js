const { app, BrowserWindow } = require("electron");
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");
const APP_VERSION = app.getVersion();
let mainWindow = null;
let isQuitting = false;
let serverProc = null;

function prepareWorkspace() {
  const ws = getWorkspaceDir();
  ensureDir(ws);

  // Workspace-Version prüfen (automatisch „frisch“ machen bei Update)
  const versionFile = path.join(ws, ".version");
  let workspaceVersion = "";
  if (fs.existsSync(versionFile)) {
    workspaceVersion = String(fs.readFileSync(versionFile, "utf8") || "").trim();
  }

  if (workspaceVersion !== APP_VERSION) {
    console.log("Workspace update needed:", workspaceVersion, "→", APP_VERSION);

    // Workspace neu erstellen
    fs.rmSync(ws, { recursive: true, force: true });
    fs.mkdirSync(ws, { recursive: true });

    // Version schreiben
    fs.writeFileSync(versionFile, APP_VERSION, "utf8");
  }

  const defaults = getDefaultsDir();

  // code
  copyIfMissing(path.join(defaults, "code", "server.js"),   path.join(ws, "server.js"));
  copyIfMissing(path.join(defaults, "code", "control.html"), path.join(ws, "control.html"));
  copyIfMissing(path.join(defaults, "code", "overlay.html"), path.join(ws, "overlay.html"));

  // presets
  copyIfMissing(path.join(defaults, "presets", "lt_presets.json"), path.join(ws, "lt_presets.json"));
  copyIfMissing(path.join(defaults, "presets", "ci_profiles.json"), path.join(ws, "ci_profiles.json"));

  return ws;
}



function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function copyIfMissing(src, dst) {
  if (!fs.existsSync(dst)) fs.copyFileSync(src, dst);
}

function getDefaultsDir() {
  // Dev: v1.0.0/app  -> defaults liegt neben app
  // Packaged: .../Contents/Resources/defaults (extraResources)
  if (app.isPackaged) return path.join(process.resourcesPath, "defaults");
  return path.resolve(__dirname, "..", "defaults");
}

function getWorkspaceDir() {
  // hierhin darf geschrieben werden
  return path.join(app.getPath("userData"), "workspace");
}


function startServer(workspaceDir) {
  const serverPath = path.join(workspaceDir, "server.js");

  // Wichtig: express/socket.io liegen in app/node_modules
  const appNodeModules = path.join(app.getAppPath(), "node_modules");
  

  const env = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: "1",
    NODE_PATH: [appNodeModules, process.env.NODE_PATH].filter(Boolean).join(path.delimiter),
    OVERLAY_WORKSPACE: workspaceDir,
    DEFAULTS_DIR: getDefaultsDir(),          // ✅ HIER
    PORT: "3000"
  };
  

  // Node-Child via Electron (als Node) starten
  serverProc = spawn(process.execPath, [serverPath], {
    cwd: workspaceDir,
    env,
    stdio: ["ignore", "pipe", "pipe"]
  });

  serverProc.stdout.on("data", (d) => console.log("[server]", String(d).trim()));
  serverProc.stderr.on("data", (d) => console.error("[server]", String(d).trim()));

  serverProc.on("exit", (code, signal) => {
    console.error("Overlay Server exited:", { code, signal });
    serverProc = null;
  });
}

function stopServer() {
  if (serverProc) {
    try { serverProc.kill(); } catch {}
    serverProc = null;
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 850,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  mainWindow.loadURL("http://127.0.0.1:3000/control.html");

  // ❗WICHTIG: Fenster schließen = NICHT App beenden
  mainWindow.on("close", (e) => {
    if (!isQuitting && process.platform === "darwin") {
      e.preventDefault();
      mainWindow.hide();
    }
  });
}


app.whenReady().then(() => {
  const ws = prepareWorkspace();
  startServer(ws);

  // kleinen Moment warten, bis Express oben ist
  setTimeout(createWindow, 400);
});

app.on("before-quit", () => {
  isQuitting = true;
  stopServer();
});

app.on("window-all-closed", () => {
  // Auf macOS NICHT quitten
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (mainWindow) {
    mainWindow.show();
  } else {
    createWindow();
  }
});

