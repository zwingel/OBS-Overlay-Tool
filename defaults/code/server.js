const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const fs = require("fs");
const path = require("path");
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });
const DEFAULTS_DIR = process.env.DEFAULTS_DIR;

console.log("SERVER BUILD:", "2026-02-08-STATE-ENDPOINT");


function needDefaults() {
  if (!DEFAULTS_DIR) throw new Error("DEFAULTS_DIR fehlt (wird von der App nicht gesetzt).");
  return DEFAULTS_DIR;
}

const workspace = process.env.OVERLAY_WORKSPACE || __dirname;

function copyFile(src, dst) {
  if (!fs.existsSync(src)) throw new Error("Default fehlt: " + src);
  fs.copyFileSync(src, dst);
}

app.use(express.json({ limit: "25mb" }));
app.use(express.static(__dirname));

/* =========================
   Persistenz-Helfer
========================= */
function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    const raw = fs.readFileSync(file, "utf8");
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) {
    console.error("readJson failed:", file, e);
    return fallback;
  }
}
function writeJson(file, obj) {
  try {
    fs.writeFileSync(file, JSON.stringify(obj, null, 2), "utf8");
  } catch (e) {
    console.error("writeJson failed:", file, e);
  }
}
function isHex(v) {
  return /^#([0-9a-fA-F]{6})$/.test(String(v || ""));
}

/* =========================
   CI-Profile (serverseitig)
========================= */
const CI_FILE = path.join(workspace, "ci_profiles.json");
let ciStore = readJson(CI_FILE, { profiles: {}, last: "" });

// GET alle CI Profile
app.get("/api/ci", (req, res) => res.json(ciStore));

// Save/Update CI Profil
app.post("/api/ci/save", (req, res) => {
  const name = String(req.body?.name || "").trim();
  const primary = String(req.body?.primary || "").trim();
  const secondary = String(req.body?.secondary || "").trim();

  if (!name) return res.status(400).json({ ok: false, error: "name required" });
  if (!isHex(primary) || !isHex(secondary)) {
    return res.status(400).json({ ok: false, error: "colors must be #RRGGBB" });
  }

  ciStore.profiles[name] = { primary, secondary };
  ciStore.last = name;
  writeJson(CI_FILE, ciStore);
  res.json({ ok: true });
});

// Delete CI Profil
app.post("/api/ci/delete", (req, res) => {
  const name = String(req.body?.name || "").trim();
  if (!name) return res.status(400).json({ ok: false, error: "name required" });

  delete ciStore.profiles[name];
  if (ciStore.last === name) ciStore.last = "";
  writeJson(CI_FILE, ciStore);
  res.json({ ok: true });
});

/* =========================
   Lower Third Presets + Slots
========================= */
const LT_FILE = path.join(workspace, "lt_presets.json");
let ltStore = readJson(LT_FILE, {
  presets: {}, // { "Partei A": {name,subtitle,topColor,bottomColor,textColor,autoHideSec} }
  slots: Array.from({ length: 8 }, () => ({ preset: "", side: "left" })), // 1..8
  activeSlot: 1
});

/* =========================
   Reset (CODE / PRESETS)
   erwartet defaults/ neben workspace/
========================= */

function ts() {
  const d = new Date();
  const pad = (n)=> String(n).padStart(2,"0");
  return `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function copyFileSafe(src, dst) {
  if (!fs.existsSync(src)) throw new Error(`Default fehlt: ${src}`);
  fs.copyFileSync(src, dst);
}

function backupFiles(files, backupDir) {
  ensureDir(backupDir);
  for (const f of files) {
    const src = path.join(__dirname, f);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(backupDir, f));
    }
  }
}

function resetGroup(kind) {
  // kind: "code" | "presets"
  const defaultsBase = path.join(__dirname, "..", "defaults", kind);

  const groups = {
    code: ["server.js", "control.html", "overlay.html"],
    presets: ["lt_presets.json", "ci_profiles.json"]
  };

  const files = groups[kind];
  if (!files) throw new Error("unknown reset kind");

  // Backup
  const backupDir = path.join(__dirname, "_backups", `${kind}_${ts()}`);
  backupFiles(files, backupDir);

  // Restore from defaults
  for (const f of files) {
    const src = path.join(defaultsBase, f);
    const dst = path.join(__dirname, f);
    copyFileSafe(src, dst);
  }

  return { ok: true, kind, backupDir, files };
}

// Code reset
app.post("/api/reset/code", (req, res) => {
  try {
    const defaults = needDefaults();

    copyFile(path.join(defaults, "code", "server.js"),   path.join(workspace, "server.js"));
    copyFile(path.join(defaults, "code", "control.html"), path.join(workspace, "control.html"));
    copyFile(path.join(defaults, "code", "overlay.html"), path.join(workspace, "overlay.html"));

    res.json({ ok:true });
  } catch (e) {
    res.status(500).json({ ok:false, error: String(e.message || e) });
  }
});


// Preset reset
// Preset reset
app.post("/api/reset/presets", (req, res) => {
  try {
    const defaults = needDefaults();

    // Dateien zurücksetzen
    copyFile(path.join(defaults, "presets", "lt_presets.json"),
             path.join(workspace, "lt_presets.json"));

    copyFile(path.join(defaults, "presets", "ci_profiles.json"),
             path.join(workspace, "ci_profiles.json"));
    // Server-RAM neu laden
    ltStore = readJson(LT_FILE, {
      presets: {},
      slots: Array.from({ length: 8 }, () => ({ preset: "", side: "left" })),
      activeSlot: 1
    });
    normalizeSlots();

    ciStore = readJson(CI_FILE, { profiles: {}, last: "" });

    // UI sofort aktualisieren
    io.emit("ciStore", ciStore);
    io.emit("ltStore", {
      presets: ltStore.presets,
      slots: ltStore.slots,
      shownSlot: state.shownSlot
    });

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok:false, error: String(e.message || e) });
  }
});


function normalizeSlots() {
  if (!Array.isArray(ltStore.slots)) ltStore.slots = [];
  while (ltStore.slots.length < 8) ltStore.slots.push({ preset: "", side: "left" });
  ltStore.slots = ltStore.slots.slice(0, 8).map(s => ({
    preset: String(s?.preset || ""),
    side: (s?.side === "right") ? "right" : "left"
  }));
  ltStore.activeSlot = Math.max(1, Math.min(8, Number(ltStore.activeSlot || 1)));
}
normalizeSlots();

function saveLtStore() {
  normalizeSlots();
  writeJson(LT_FILE, ltStore);
}

function sanitizeLtPreset(p) {
  return {
    name: String(p?.name || "").slice(0, 80),
    subtitle: String(p?.subtitle || "").slice(0, 140),
    topColor: isHex(p?.topColor) ? p.topColor : "#c23b3b",
    bottomColor: isHex(p?.bottomColor) ? p.bottomColor : "#a9a9a9",
    textColor: isHex(p?.textColor) ? p.textColor : "#000000",
    autoHideSec: Math.max(0, Number(p?.autoHideSec || 0) || 0)
  };
}

// GET LT store
app.get("/api/lt", (req, res) => {
  normalizeSlots();
  res.json({
    presets: ltStore.presets,
    slots: ltStore.slots,
    shownSlot: state.shownSlot
  });
});

// Save LT preset
app.post("/api/lt/save", (req, res) => {
  const presetName = String(req.body?.presetName || "").trim();
  const preset = sanitizeLtPreset(req.body?.preset || {});
  if (!presetName) return res.status(400).json({ ok: false, error: "presetName required" });

  ltStore.presets[presetName] = preset;
  saveLtStore();
  res.json({ ok: true });
});

// Delete LT preset
app.post("/api/lt/delete", (req, res) => {
  const presetName = String(req.body?.presetName || "").trim();
  if (!presetName) return res.status(400).json({ ok: false, error: "presetName required" });

  delete ltStore.presets[presetName];
  ltStore.slots = ltStore.slots.map(s => (s.preset === presetName ? { preset: "", side: s.side } : s));
  saveLtStore();
  res.json({ ok: true });
});

// Assign preset+side to slot (1..8)
app.post("/api/lt/slot", (req, res) => {
  const slot = Math.max(1, Math.min(8, Number(req.body?.slot || 1)));
  const presetName = String(req.body?.presetName || "").trim();
  const side = (req.body?.side === "right") ? "right" : "left";

  ltStore.slots[slot - 1] = { preset: presetName, side };
  saveLtStore();
  res.json({ ok: true });
});

// Set active slot (1..8) for StreamDeck
app.post("/api/lt/active", (req, res) => {
  const slot = Math.max(1, Math.min(8, Number(req.body?.slot || 1)));
  ltStore.activeSlot = slot;
  saveLtStore();
  res.json({ ok: true });
});

/* =========================
   Live-State (Socket.IO)
========================= */
let state = {
  lowerThird: {
    left: { visible: false, name: "", subtitle: "", topColor: "#c23b3b", bottomColor: "#a9a9a9", textColor: "#000000", autoHideSec: 0 },
    right:{ visible: false, name: "", subtitle: "", topColor: "#c23b3b", bottomColor: "#a9a9a9", textColor: "#000000", autoHideSec: 0 }
  },
  scoreboard: {
    visible: false,
    team1: { name: "Team 1", color: "#d40000", textColor: "#ffffff", score: 0 },
    team2: { name: "Team 2", color: "#0a22d6", textColor: "#ffffff", score: 0 },
    clock: {
  enabled: false,
  running: false,
  seconds: 0,
  textColor: "#111111",
  startedAtMs: null,   // NEU
  startSeconds: 0      // NEU
}
  },
  scale: { lowerThird: 1.0, scoreboard: 1.0, timer: 1.0 },
  timer: {
    visible: false,
    mode: "countdown",
    running: false,
    totalSeconds: 300,
    seconds: 300,
    label: "",
    textColor: "#ffffff",
    ringColor: "#ff0000",
    backgroundDataUrl: "",
    pos: { x: 0, y: 0 },

    startedAtMs: null,   // NEU
    startSeconds: 300    // NEU (wird beim Start gesetzt)
  },
shownSlot: { left: null, right: null },
};

app.get("/api/state", (req, res) => {
  res.json(state);
});

function deepMerge(target, src) {
  if (typeof src !== "object" || src === null) return target;
  const out = Array.isArray(target) ? [...target] : { ...target };
  for (const [k, v] of Object.entries(src)) {
    if (v && typeof v === "object" && !Array.isArray(v)) out[k] = deepMerge(target?.[k] ?? {}, v);
    else out[k] = v;
  }
  return out;
}

function broadcast() { io.emit("state", state); }

function scheduleAutoHide(side) {
  const auto = Number(state.lowerThird[side].autoHideSec || 0);
  if (auto <= 0) return;

  const token = Date.now();
  state.lowerThird[side]._autoToken = token;

  setTimeout(() => {
    if (state.lowerThird[side]._autoToken === token) {
      state.lowerThird[side].visible = false;
      state.shownSlot[side] = null;     // <--- WICHTIG
      broadcast();
    }
  }, auto * 1000);
}

function applyLtPresetToSide(preset, side) {
  const s = state.lowerThird[side];
  s.name = preset.name || "";
  s.subtitle = preset.subtitle || "";
  s.topColor = preset.topColor || s.topColor;
  s.bottomColor = preset.bottomColor || s.bottomColor;
  s.textColor = preset.textColor || s.textColor;
  s.autoHideSec = Number(preset.autoHideSec || 0);
}

/* =========================
   CLOCK / TIMER CONTROL
========================= */

const nowMs = () => Date.now();

// ---- CLOCK ----
function startClock() {
  if (!state.scoreboard.clock.enabled) return;
  if (state.scoreboard.clock.running) return;
  state.scoreboard.clock.running = true;
  state.scoreboard.clock.startedAtMs = nowMs();
  state.scoreboard.clock.startSeconds = Math.max(0, Number(state.scoreboard.clock.seconds || 0));
}

function stopClock() {
  if (!state.scoreboard.clock.running) return;
  state.scoreboard.clock.running = false;
  state.scoreboard.clock.startedAtMs = null;
}

// ---- TIMER ----
function startTimer() {
  if (state.timer.running) return;
  state.timer.running = true;
  state.timer.startedAtMs = nowMs();
  state.timer.startSeconds = Math.max(0, Number(state.timer.seconds || 0));
}

function stopTimer() {
  if (!state.timer.running) return;
  state.timer.running = false;
  state.timer.startedAtMs = null;
}


function handleAction(a) {
  const t = a?.type;

  if (a?.type === "sync") {
  broadcast();
  return;
}

  // ===== LowerThird manuell =====
  if (t === "lt_show" || t === "lt_hide") {
    const side = (a.side === "right") ? "right" : "left";
    state.lowerThird[side].visible = (t === "lt_show");

    if (t === "lt_show") {
      scheduleAutoHide(side);
    } else {
      state.shownSlot[side] = null;
      state.lowerThird[side]._autoToken = 0;
    }
  }

  // ===== LT Slot: show/hide (slot 1..8) =====
  if (t === "lt_slot_show") {
    const slot = Math.max(1, Math.min(8, Number(a.slot || 1)));

    normalizeSlots();
    const cfg = ltStore.slots[slot - 1];
    const preset = ltStore.presets[cfg.preset];

    const side = (cfg.side === "right") ? "right" : "left";

    if (preset) {
      applyLtPresetToSide(preset, side);
      state.lowerThird[side].visible = true;
      state.shownSlot[side] = slot;
      scheduleAutoHide(side);
    }
  }

  if (t === "lt_slot_hide") {
    const slot = Math.max(1, Math.min(8, Number(a.slot || 1)));

    normalizeSlots();
    const cfg = ltStore.slots[slot - 1];
    const side = (cfg.side === "right") ? "right" : "left";

    state.lowerThird[side].visible = false;
    state.shownSlot[side] = null;
    state.lowerThird[side]._autoToken = 0;
  }

  // ===== LT Active Slot: StreamDeck-friendly =====
  if (t === "lt_active_show") {
    normalizeSlots();
    const slot = Math.max(1, Math.min(8, Number(ltStore.activeSlot || 1)));
    const cfg = ltStore.slots[slot - 1];
    const preset = ltStore.presets[cfg.preset];
    const side = (a.side === "left" || a.side === "right") ? a.side : cfg.side;

    if (preset) {
      applyLtPresetToSide(preset, side);
      state.lowerThird[side].visible = true;
      state.shownSlot[side] = slot;
      scheduleAutoHide(side);
    }
  }

  if (t === "lt_active_hide") {
    const side = (a.side === "right") ? "right" : "left";
    state.lowerThird[side].visible = false;
    state.shownSlot[side] = null;
    state.lowerThird[side]._autoToken = 0;
  }

  // ===== Scoreboard =====
  if (t === "sb_show") state.scoreboard.visible = true;
  if (t === "sb_hide") state.scoreboard.visible = false;
  if (t === "sb_reset") { state.scoreboard.team1.score = 0; state.scoreboard.team2.score = 0; }
  if (t === "sb_inc") { const k = a.team === 2 ? "team2" : "team1"; state.scoreboard[k].score += 1; }
  if (t === "sb_dec") { const k = a.team === 2 ? "team2" : "team1"; state.scoreboard[k].score = Math.max(0, state.scoreboard[k].score - 1); }

  // ✅ Clock (NICHT doppelt!)
  if (t === "clock_toggle") {
    state.scoreboard.clock.enabled = !state.scoreboard.clock.enabled;
    if (!state.scoreboard.clock.enabled) stopClock();
  }
  if (t === "clock_startstop") {
    if (state.scoreboard.clock.running) stopClock();
    else startClock();
  }
  if (t === "clock_reset") {
    stopClock();
    state.scoreboard.clock.seconds = 0;
  }
  if (t === "clock_set") {
    stopClock();
    state.scoreboard.clock.seconds = Math.max(0, Number(a.seconds || 0));
  }

  // ===== Timer =====
  if (t === "timer_show") state.timer.visible = true;
  if (t === "timer_hide") state.timer.visible = false;

  if (t === "timer_startstop") {
    if (state.timer.running) stopTimer();
    else startTimer();
  }

  if (t === "timer_reset") {
    stopTimer();
    state.timer.seconds = state.timer.mode === "countdown" ? state.timer.totalSeconds : 0;
  }

  if (t === "timer_set") {
    stopTimer();
    const total = Math.max(0, Number(a.totalSeconds || 0));
    state.timer.totalSeconds = total;
    if (state.timer.mode === "countdown") state.timer.seconds = total;
  }

  if (t === "timer_mode") {
    stopTimer();
    state.timer.mode = (a.mode === "countup") ? "countup" : "countdown";
    state.timer.seconds = state.timer.mode === "countdown" ? state.timer.totalSeconds : 0;
  }
}


// serverseitige Ticks
setInterval(() => {
  let changed = false;
  const now = Date.now();


  // ---- Clock berechnen ----
  const c = state.scoreboard.clock;
  if (c.enabled && c.running && c.startedAtMs != null) {
    const elapsed = Math.floor((now - c.startedAtMs) / 1000);
    const newSec = c.startSeconds + elapsed;
    if (newSec !== c.seconds) { c.seconds = newSec; changed = true; }
  }

  // ---- Timer berechnen ----
  const tm = state.timer;
  if (tm.running && tm.startedAtMs != null) {
    const elapsed = Math.floor((now - tm.startedAtMs) / 1000);

    let newSec;
    if (tm.mode === "countdown") {
      newSec = Math.max(0, tm.startSeconds - elapsed);
      if (newSec === 0) stopTimer(); // auto stop bei 0
    } else {
      newSec = tm.startSeconds + elapsed;
    }

    if (newSec !== tm.seconds) { tm.seconds = newSec; changed = true; }
  }

  if (changed) broadcast();
}, 200);

// Komfort
app.get("/", (req, res) => res.redirect("/overlay.html"));
app.get("/control", (req, res) => res.redirect("/control.html"));

// REST für StreamDeck/Companion
app.post("/api/action", (req, res) => { handleAction(req.body); broadcast(); res.json({ ok: true }); });
app.post("/api/patch", (req, res) => { state = deepMerge(state, req.body); broadcast(); res.json({ ok: true }); });

/* =========================
   SOCKET.IO LIVE STEUERUNG
========================= */

io.on("connection", (socket) => {
  console.log("Client connected");

  // aktuellen State sofort schicken
  socket.emit("state", state);

  // ACTION (Buttons)
  socket.on("action", (a) => {
    try {
      handleAction(a);
      broadcast();
    } catch (e) {
      console.error("action error:", e);
    }
  });

  // PATCH (Formular / Übernehmen Buttons)
  socket.on("patch", (p) => {
    try {
      state = deepMerge(state, p);
      broadcast();
    } catch (e) {
      console.error("patch error:", e);
    }
  });

  socket.on("disconnect", () => {
    console.log("Client disconnected");
  });
});

function clearAll() {
  state.lowerThird.left.visible = false;
  state.lowerThird.right.visible = false;
  state.scoreboard.visible = false;
  if (state.timer) state.timer.visible = false; // falls vorhanden
}

function gracefulShutdown() {
  try {
    clearAll();
    broadcast();
  } catch {}

  // kleinen Moment geben, damit Clients das noch bekommen
  setTimeout(() => process.exit(0), 150);
}

/* ==================
   Translations
================= */

app.get("/api/i18n", (req, res) => {
  res.sendFile(path.join(__dirname, "translations.json"));
});


process.on("SIGTERM", gracefulShutdown);
process.on("SIGINT", gracefulShutdown);


const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Overlay: http://localhost:${PORT}/overlay.html / Panel: http://localhost:${PORT}/control.html)`));
console.log("SERVER BUILD (before listen):", "2026-02-08-0332");
