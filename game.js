import { COLS, ROWS, createState, pause, queueDir, restart, resume, step } from "./logic.js";

const BEST_KEY = "snakes.best";
const MUTE_KEY = "snakes.muted";
const DIRS = {
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  KeyW: [0, -1],
  KeyS: [0, 1],
  KeyA: [-1, 0],
  KeyD: [1, 0],
};

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const board = document.getElementById("board");
const overlay = document.getElementById("overlay");
const overlayTitle = document.getElementById("overlay-title");
const overlayText = document.getElementById("overlay-text");
const actionBtn = document.getElementById("action");
const scoreEl = document.getElementById("score");
const bestEl = document.getElementById("best");
const bestStat = document.getElementById("best-stat");
const lengthEl = document.getElementById("length");
const muteBtn = document.getElementById("mute");
const toast = document.getElementById("toast");
const live = document.getElementById("live");

const state = createState();
const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const particles = [];
const view = { w: 640, h: 640, cell: 28, ox: 16, oy: 16, dpr: 1 };

let best = loadBest();
let bestSnapshot = best;
let muted = loadMuted();
let audioCtx = null;
let acc = 0;
let last = 0;
let deadAt = 0;
let foodBorn = 0;
let goldenBorn = 0;
let toastTimer = 0;

const ARM_MS = 520;
const padDirs = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
const padByName = {};
const heldDirs = new Set();

let arming = false;
let armTimer = 0;
let pendingDir = null;

function loadBest() {
  try {
    const n = Number(localStorage.getItem(BEST_KEY));
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  } catch {
    return 0;
  }
}

function loadMuted() {
  try {
    return localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}

function save(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode */
  }
}

function resize() {
  const rect = board.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.max(1, rect.width);
  const h = Math.max(1, rect.height);
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const inset = Math.max(12, w * 0.03);
  view.w = w;
  view.h = h;
  view.dpr = dpr;
  view.cell = Math.min((w - inset * 2) / COLS, (h - inset * 2) / ROWS);
  view.ox = (w - view.cell * COLS) / 2;
  view.oy = (h - view.cell * ROWS) / 2;
}

function cellCenter(x, y) {
  return {
    x: view.ox + (x + 0.5) * view.cell,
    y: view.oy + (y + 0.5) * view.cell,
  };
}

function say(text) {
  live.textContent = text;
}

function noteScore(pop) {
  if (state.score > best) {
    best = state.score;
    save(BEST_KEY, String(best));
  }
  scoreEl.textContent = String(state.score);
  bestEl.textContent = String(best);
  lengthEl.textContent = String(state.snake.length);
  bestStat.classList.toggle("is-record", state.score > bestSnapshot && state.score > 0);
  if (pop) {
    scoreEl.classList.remove("pop");
    void scoreEl.offsetWidth;
    scoreEl.classList.add("pop");
  }
}

function renderMute() {
  muteBtn.textContent = muted ? "音效關" : "音效開";
  muteBtn.setAttribute("aria-label", muted ? "打開音效" : "關閉音效");
}

function toggleMute() {
  muted = !muted;
  save(MUTE_KEY, muted ? "1" : "0");
  renderMute();
  if (!muted) unlockAudio();
}

function showOverlay(title, text, label) {
  overlayTitle.textContent = title;
  overlayText.textContent = text;
  actionBtn.textContent = label;
  overlay.hidden = false;
}

function hideOverlay() {
  overlay.hidden = true;
}

function showToast(text) {
  toast.textContent = text;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.hidden = true;
  }, 1600);
}

function dirName(x, y) {
  if (y === -1) return "up";
  if (y === 1) return "down";
  if (x === -1) return "left";
  if (x === 1) return "right";
  return "";
}

function holdDir(name) {
  const button = padByName[name];
  if (!button) return;
  heldDirs.add(name);
  button.classList.add("lit");
  button.setAttribute("aria-pressed", "true");
}

function releaseDir(name) {
  const button = padByName[name];
  heldDirs.delete(name);
  if (!button) return;
  window.setTimeout(() => {
    if (heldDirs.has(name)) return;
    button.classList.remove("lit");
    button.setAttribute("aria-pressed", "false");
  }, 120);
}

function blipDir(name) {
  const button = padByName[name];
  if (!button) return;
  button.classList.add("lit");
  button.setAttribute("aria-pressed", "true");
  window.setTimeout(() => {
    if (heldDirs.has(name)) return;
    button.classList.remove("lit");
    button.setAttribute("aria-pressed", "false");
  }, 160);
}

function heldDirection() {
  if (heldDirs.size !== 1) return null;
  const name = heldDirs.values().next().value;
  const dir = padDirs[name];
  return dir ? [dir[0], dir[1]] : null;
}

function begin(force) {
  unlockAudio();
  if (arming) return;
  if (!force && state.status === "paused") {
    resume(state);
    last = 0;
    hideOverlay();
    say("繼續");
    return;
  }
  armStart();
}

function armStart() {
  arming = true;
  if (overlay.hidden) showOverlay("Snakes", "方向鍵或 WASD 移動。", "開始");
  board.classList.add("arming");
  actionBtn.classList.add("arming");
  actionBtn.disabled = true;
  actionBtn.setAttribute("aria-busy", "true");
  window.clearTimeout(armTimer);
  armTimer = window.setTimeout(finishArm, ARM_MS);
}

function cancelArm() {
  if (!arming) return;
  arming = false;
  pendingDir = null;
  window.clearTimeout(armTimer);
  board.classList.remove("arming");
  actionBtn.classList.remove("arming");
  actionBtn.disabled = false;
  actionBtn.removeAttribute("aria-busy");
}

function finishArm() {
  if (!arming) return;
  const dir = pendingDir || heldDirection();
  pendingDir = null;
  arming = false;
  board.classList.remove("arming");
  actionBtn.classList.remove("arming");
  actionBtn.disabled = false;
  actionBtn.removeAttribute("aria-busy");
  restart(state);
  acc = 0;
  particles.length = 0;
  last = 0;
  bestSnapshot = best;
  hideOverlay();
  toast.hidden = true;
  noteScore(false);
  blipStart();
  say("遊戲開始");
  if (dir) queueDir(state, dir[0], dir[1]);
}

function onSpace() {
  if (arming) return;
  if (state.status === "playing") {
    pause(state);
    showOverlay("暫停", "空白鍵繼續，R 重新開始。", "繼續");
    say("暫停");
    return;
  }
  if (state.status === "paused") {
    begin(false);
    return;
  }
  begin(true);
}

function pressDir(x, y, hold) {
  unlockAudio();
  const name = dirName(x, y);
  if (hold) holdDir(name);
  else blipDir(name);
  if (arming) {
    pendingDir = [x, y];
    return;
  }
  if (state.status === "playing" || state.status === "paused") {
    queueDir(state, x, y);
    return;
  }
  pendingDir = [x, y];
  begin(true);
}

function handleEvent(result) {
  if (!result) return;
  const ate = result.event === "eat" || result.event === "eat-gold-spawn" || result.event === "gold";
  if (ate || result.event === "win") noteScore(ate || result.event === "win");
  if (ate && state.swallowed) {
    burst(state.swallowed, result.event === "gold" ? "#ffd15c" : "#ff5a5f");
    buzz(result.event === "gold" ? [12, 24, 12] : 12);
    if (result.event === "gold") blipGold();
    else blipEat();
  }
  if (result.event === "eat" || result.event === "eat-gold-spawn") foodBorn = performance.now();
  if (result.event === "eat-gold-spawn") {
    goldenBorn = performance.now();
    showToast("金蘋果 · 50 分");
  }
  if (result.event === "dead") {
    noteScore(false);
    deadAt = performance.now();
    blipDead();
    buzz(40);
    const record = state.score > bestSnapshot && state.score > 0;
    showOverlay(
      "這局結束了",
      record
        ? `新紀錄 ${state.score} 分 · 長度 ${state.snake.length}`
        : `分數 ${state.score} · 長度 ${state.snake.length}`,
      "再來一局",
    );
    say(record ? `遊戲結束，新紀錄 ${state.score} 分` : `遊戲結束，分數 ${state.score}`);
  }
  if (result.event === "win") {
    blipGold();
    showOverlay("果園清空", `分數 ${state.score}。整座果園都被吃完了。`, "再玩一次");
    say(`過關，分數 ${state.score}`);
  }
}

function frame(now) {
  requestAnimationFrame(frame);
  if (!last) last = now;
  let delta = now - last;
  last = now;
  if (delta > 100) delta = 100;

  if (state.status === "playing" && !arming) {
    acc += delta;
    while (acc >= state.tickMs && state.status === "playing") {
      const before = state.tickMs;
      const result = step(state);
      acc -= before;
      handleEvent(result);
      if (state.status !== "playing") {
        acc = state.tickMs;
        break;
      }
    }
  }

  updateParticles(delta);
  const moving = state.status === "playing" || state.status === "paused";
  const t = moving ? Math.min(1, acc / state.tickMs) : 1;
  draw(now, t);
}

function draw(now, t) {
  ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
  ctx.clearRect(0, 0, view.w, view.h);
  ctx.fillStyle = "#0e1f16";
  ctx.fillRect(0, 0, view.w, view.h);

  const shake = !reduced && state.status === "dead" ? Math.max(0, 1 - (now - deadAt) / 360) : 0;
  ctx.save();
  if (shake) {
    ctx.translate(Math.sin(now * 0.05) * 6 * shake, Math.cos(now * 0.07) * 5 * shake);
  }
  drawBoard();
  if (state.swallowed) drawApple(state.swallowed, state.swallowed.kind, 1 - t, now, 1);
  if (state.food) drawApple(state.food, "food", 1, now, popScale(now, foodBorn));
  if (state.golden) drawApple(state.golden, "gold", 1, now, popScale(now, goldenBorn));
  drawSnake(t, now);
  drawParticles();
  ctx.restore();

  if (state.status === "dead") {
    const k = Math.max(0, 1 - (now - deadAt) / 520);
    ctx.fillStyle = `rgba(255, 70, 70, ${0.25 * k})`;
    ctx.fillRect(0, 0, view.w, view.h);
  }
}

function popScale(now, born) {
  if (!born) return 1;
  const u = Math.min(1, (now - born) / 180);
  return 0.55 + 0.45 * u;
}

function drawBoard() {
  for (let y = 0; y < ROWS; y += 1) {
    for (let x = 0; x < COLS; x += 1) {
      ctx.fillStyle = (x + y) % 2 === 0 ? "rgba(214, 242, 180, 0.045)" : "rgba(0, 0, 0, 0.16)";
      const m = view.cell * 0.08;
      roundRect(
        view.ox + x * view.cell + m,
        view.oy + y * view.cell + m,
        view.cell - m * 2,
        view.cell - m * 2,
        view.cell * 0.22,
      );
      ctx.fill();
    }
  }
}

function drawSnake(t, now) {
  const pts = [];
  for (let i = 0; i < state.snake.length; i += 1) {
    const a = state.from[i];
    const b = state.snake[i];
    const gx = a.x + (b.x - a.x) * t;
    const gy = a.y + (b.y - a.y) * t;
    pts.push(cellCenter(gx, gy));
  }
  if (!pts.length) return;

  const base = view.cell * 0.34;
  const radiusAt = (i) => {
    const taper = pts.length === 1 ? 0 : i / (pts.length - 1);
    return base * (1.08 - taper * 0.3);
  };

  ctx.save();
  ctx.translate(0, view.cell * 0.07);
  ctx.lineCap = "round";
  ctx.strokeStyle = "rgba(0, 0, 0, 0.28)";
  ctx.fillStyle = "rgba(0, 0, 0, 0.28)";
  for (let i = pts.length - 1; i >= 0; i -= 1) {
    const rad = radiusAt(i);
    if (i < pts.length - 1) {
      ctx.lineWidth = rad + radiusAt(i + 1);
      ctx.beginPath();
      ctx.moveTo(pts[i].x, pts[i].y);
      ctx.lineTo(pts[i + 1].x, pts[i + 1].y);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(pts[i].x, pts[i].y, rad, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  ctx.lineCap = "round";
  for (let i = pts.length - 1; i >= 0; i -= 1) {
    const taper = pts.length === 1 ? 0 : i / (pts.length - 1);
    const color = mix("#d6ff6b", "#146b3a", Math.pow(taper, 0.85));
    const rad = radiusAt(i);
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.shadowColor = i === 0 ? "rgba(214, 255, 107, 0.45)" : "transparent";
    ctx.shadowBlur = i === 0 ? 14 : 0;
    if (i < pts.length - 1) {
      ctx.lineWidth = rad + radiusAt(i + 1);
      ctx.beginPath();
      ctx.moveTo(pts[i].x, pts[i].y);
      ctx.lineTo(pts[i + 1].x, pts[i + 1].y);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(pts[i].x, pts[i].y, rad, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.shadowBlur = 0;
  drawEyes(pts[0], radiusAt(0), now);
}

function drawEyes(head, rad, now) {
  const fx = state.dir.x;
  const fy = state.dir.y;
  const px = -fy;
  const py = fx;
  for (const side of [-1, 1]) {
    const x = head.x + fx * rad * 0.28 + px * rad * 0.42 * side;
    const y = head.y + fy * rad * 0.28 + py * rad * 0.42 * side;
    ctx.fillStyle = "#10240f";
    ctx.beginPath();
    ctx.arc(x, y, rad * 0.18, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.beginPath();
    ctx.arc(x + rad * 0.05, y - rad * 0.05, rad * 0.07, 0, Math.PI * 2);
    ctx.fill();
  }
  if (state.status === "playing" && Math.sin(now / 140) > 0.35) {
    ctx.strokeStyle = "#ff6b81";
    ctx.lineWidth = Math.max(1.4, rad * 0.08);
    ctx.lineCap = "round";
    const x = head.x + fx * rad * 0.95;
    const y = head.y + fy * rad * 0.95;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + fx * rad * 0.42 + px * rad * 0.16, y + fy * rad * 0.42 + py * rad * 0.16);
    ctx.moveTo(x, y);
    ctx.lineTo(x + fx * rad * 0.42 - px * rad * 0.16, y + fy * rad * 0.42 - py * rad * 0.16);
    ctx.stroke();
  }
}

function drawApple(cell, kind, alpha, now, scale) {
  if (!cell || alpha <= 0) return;
  const bob = Math.sin(now / 280 + (kind === "gold" ? 1.4 : 0)) * view.cell * 0.05;
  const p = cellCenter(cell.x, cell.y);
  p.y += bob;
  const rad = view.cell * (kind === "gold" ? 0.3 : 0.28) * scale;
  ctx.save();
  ctx.globalAlpha = Math.max(0, alpha);
  ctx.fillStyle = "rgba(0,0,0,0.25)";
  ctx.beginPath();
  ctx.ellipse(p.x, p.y + rad * 0.95, rad * 0.62, rad * 0.24, 0, 0, Math.PI * 2);
  ctx.fill();
  if (kind === "gold") {
    ctx.strokeStyle = "rgba(255, 209, 92, 0.5)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(p.x, p.y, rad + 6 + Math.sin(now / 200) * 2.5, 0, Math.PI * 2);
    ctx.stroke();
  }
  const g = ctx.createRadialGradient(p.x - rad * 0.35, p.y - rad * 0.4, rad * 0.15, p.x, p.y, rad);
  if (kind === "gold") {
    g.addColorStop(0, "#fff1b8");
    g.addColorStop(0.55, "#ffd15c");
    g.addColorStop(1, "#e09400");
  } else {
    g.addColorStop(0, "#ffb1a8");
    g.addColorStop(0.5, "#ff4d55");
    g.addColorStop(1, "#c81e3a");
  }
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(p.x, p.y, rad, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#6b3a1f";
  ctx.lineWidth = Math.max(1.5, rad * 0.16);
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(p.x, p.y - rad * 0.72);
  ctx.quadraticCurveTo(p.x + rad * 0.15, p.y - rad * 1.2, p.x + rad * 0.02, p.y - rad * 1.35);
  ctx.stroke();
  ctx.fillStyle = kind === "gold" ? "#ffe08a" : "#7dce55";
  ctx.beginPath();
  ctx.ellipse(p.x + rad * 0.46, p.y - rad * 1.02, rad * 0.4, rad * 0.18, -0.7, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.beginPath();
  ctx.ellipse(p.x - rad * 0.28, p.y - rad * 0.32, rad * 0.2, rad * 0.11, -0.8, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawParticles() {
  for (const p of particles) {
    ctx.globalAlpha = Math.max(0, 1 - p.age / p.life);
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function burst(cell, color) {
  if (reduced || !cell) return;
  const p = cellCenter(cell.x, cell.y);
  for (let i = 0; i < 12; i += 1) {
    const a = (Math.PI * 2 * i) / 12 + Math.random() * 0.3;
    const speed = 50 + Math.random() * 110;
    particles.push({
      x: p.x,
      y: p.y,
      vx: Math.cos(a) * speed,
      vy: Math.sin(a) * speed,
      life: 0.4 + Math.random() * 0.2,
      age: 0,
      color,
      r: 2 + Math.random() * 2.2,
    });
  }
  if (particles.length > 80) particles.splice(0, particles.length - 80);
}

function updateParticles(deltaMs) {
  const dt = deltaMs / 1000;
  for (let i = particles.length - 1; i >= 0; i -= 1) {
    const p = particles[i];
    p.age += dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vy += 90 * dt;
    if (p.age >= p.life) particles.splice(i, 1);
  }
}

function roundRect(x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function mix(a, b, t) {
  const pa = hex(a);
  const pb = hex(b);
  const c = pa.map((v, i) => Math.round(v + (pb[i] - v) * t));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

function hex(value) {
  const n = Number.parseInt(value.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function unlockAudio() {
  if (muted) return;
  try {
    if (!audioCtx) audioCtx = new AudioContext();
    if (audioCtx.state === "suspended") audioCtx.resume();
  } catch {
    audioCtx = null;
  }
}

function tone(freq, dur, type, when, gain) {
  if (muted || !audioCtx) return;
  const t0 = audioCtx.currentTime + when;
  const osc = audioCtx.createOscillator();
  const amp = audioCtx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  amp.gain.setValueAtTime(gain, t0);
  amp.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(amp);
  amp.connect(audioCtx.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

function blipEat() {
  tone(520, 0.08, "sine", 0, 0.05);
  tone(760, 0.1, "sine", 0.05, 0.04);
}

function blipGold() {
  tone(660, 0.08, "triangle", 0, 0.05);
  tone(880, 0.1, "triangle", 0.07, 0.045);
  tone(1180, 0.14, "triangle", 0.13, 0.035);
}

function blipDead() {
  tone(196, 0.18, "triangle", 0, 0.04);
  tone(98, 0.28, "triangle", 0.08, 0.035);
}

function blipStart() {
  tone(440, 0.07, "sine", 0, 0.035);
  tone(660, 0.09, "sine", 0.06, 0.03);
}

function buzz(pattern) {
  if (reduced || !navigator.vibrate) return;
  navigator.vibrate(pattern);
}

let touchStart = null;
canvas.addEventListener("touchstart", (event) => {
  const t = event.changedTouches[0];
  touchStart = { x: t.clientX, y: t.clientY };
}, { passive: true });

canvas.addEventListener("touchmove", (event) => {
  if (touchStart) event.preventDefault();
}, { passive: false });

canvas.addEventListener("touchend", (event) => {
  if (!touchStart) return;
  const t = event.changedTouches[0];
  const dx = t.clientX - touchStart.x;
  const dy = t.clientY - touchStart.y;
  touchStart = null;
  if (Math.hypot(dx, dy) < 24) {
    if (state.status !== "playing" && state.status !== "paused") begin(true);
    return;
  }
  if (Math.abs(dx) > Math.abs(dy)) pressDir(dx > 0 ? 1 : -1, 0, false);
  else pressDir(0, dy > 0 ? 1 : -1, false);
}, { passive: true });

window.addEventListener("keydown", (event) => {
  if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
  if (event.target === muteBtn) return;
  if (event.target.closest?.(".pad") && (event.code === "Space" || event.code === "Enter")) return;
  const dir = DIRS[event.code];
  if (dir) {
    event.preventDefault();
    pressDir(dir[0], dir[1], true);
    return;
  }
  if (event.code === "Space") {
    event.preventDefault();
    onSpace();
    return;
  }
  if (event.code === "Enter") {
    if (event.target === actionBtn) return;
    event.preventDefault();
    onSpace();
    return;
  }
  if (event.code === "KeyR") {
    event.preventDefault();
    begin(true);
  } else if (event.code === "KeyM") {
    event.preventDefault();
    toggleMute();
  }
});

window.addEventListener("keyup", (event) => {
  const dir = DIRS[event.code];
  if (!dir) return;
  releaseDir(dirName(dir[0], dir[1]));
});

window.addEventListener("blur", () => {
  for (const name of [...heldDirs]) releaseDir(name);
});

actionBtn.addEventListener("click", () => begin(false));
overlay.addEventListener("pointerdown", (event) => {
  if (event.target.closest("button")) return;
  event.preventDefault();
  begin(false);
});
muteBtn.addEventListener("click", toggleMute);

for (const button of document.querySelectorAll(".pad button")) {
  padByName[button.dataset.dir] = button;
  const go = (event) => {
    event.preventDefault();
    const dir = padDirs[button.dataset.dir];
    pressDir(dir[0], dir[1], true);
  };
  button.addEventListener("pointerdown", (event) => {
    button.setPointerCapture?.(event.pointerId);
    go(event);
  });
  button.addEventListener("pointerup", () => releaseDir(button.dataset.dir));
  button.addEventListener("pointercancel", () => releaseDir(button.dataset.dir));
  button.addEventListener("keydown", (event) => {
    if (event.code === "Enter" || event.code === "Space") go(event);
  });
  button.addEventListener("keyup", (event) => {
    if (event.code === "Enter" || event.code === "Space") releaseDir(button.dataset.dir);
  });
}

document.addEventListener("visibilitychange", () => {
  last = 0;
  if (!document.hidden) return;
  if (arming) cancelArm();
  if (state.status === "playing") {
    pause(state);
    showOverlay("暫停", "回來之後按空白鍵繼續。", "繼續");
    say("暫停");
  }
});

new ResizeObserver(() => resize()).observe(board);
resize();
renderMute();
noteScore(false);
requestAnimationFrame(frame);
