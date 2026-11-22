const $ = (selector) => document.querySelector(selector);
const HISTORY_KEY = "wifi-pulse-history-v1";
const HISTORY_LIMIT = 30;
const history = loadHistory();
const state = { testing: false };
const downloadArc = $("#download-arc");
const uploadArc = $("#upload-arc");
const circumference = 267;

function loadHistory() {
  try {
    const saved = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
    if (!Array.isArray(saved)) return [];
    return saved
      .filter((item) => Number.isFinite(item.download) && Number.isFinite(item.upload))
      .slice(-HISTORY_LIMIT);
  } catch {
    return [];
  }
}
function saveHistory() {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(-HISTORY_LIMIT)));
  } catch {
    // Private browsing may disable storage; the live chart still works.
  }
}
function setText(selector, value) { $(selector).textContent = value; }
function nowLabel() { return new Intl.DateTimeFormat([], { hour: "numeric", minute: "2-digit" }).format(new Date()); }
function quality(value, type) {
  if (value == null) return "Waiting for a test";
  if (type === "latency") return value < 30 ? "Excellent response" : value < 80 ? "Good response" : "High latency";
  return value >= 100 ? "Excellent throughput" : value >= 25 ? "Good throughput" : "Slow connection";
}
function setGauge(arc, meter, value, max = 250) {
  const ratio = Math.min(value / max, 1);
  arc.style.strokeDashoffset = String(circumference * (1 - ratio));
  meter.style.width = `${ratio * 100}%`;
}
function updateMetric(kind, value, elapsed) {
  const formatted = value == null ? "—" : value < 1 ? value.toFixed(2) : value < 10 ? value.toFixed(1) : Math.round(value).toString();
  setText(`#${kind}-value`, formatted);
  setText(`#${kind}-quality`, quality(value, kind));
  setText(`#${kind}-time`, elapsed ? `${(elapsed / 1000).toFixed(1)}s` : "—");
  if (value != null) setGauge(kind === "download" ? downloadArc : uploadArc, $(`#${kind}-meter`), value);
}
function drawHistory() {
  const canvas = $("#history-chart");
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = rect.width * dpr; canvas.height = rect.height * dpr;
  const ctx = canvas.getContext("2d"); ctx.scale(dpr, dpr);
  const width = rect.width, height = rect.height;
  ctx.clearRect(0, 0, width, height);
  ctx.strokeStyle = getComputedStyle(document.body).getPropertyValue("--line");
  ctx.lineWidth = 1;
  for (let i = 1; i < 5; i++) { const y = (height / 5) * i; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke(); }
  if (!history.length) return;
  const max = Math.max(100, ...history.flatMap(item => [item.download, item.upload]));
  const line = (key, color) => {
    ctx.beginPath(); ctx.lineWidth = 2; ctx.strokeStyle = color;
    history.forEach((item, index) => {
      const x = history.length === 1 ? width / 2 : (index / (history.length - 1)) * width;
      const y = height - (item[key] / max) * (height - 15) - 7;
      index ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    });
    ctx.stroke();
  };
  line("download", getComputedStyle(document.body).getPropertyValue("--cyan"));
  line("upload", getComputedStyle(document.body).getPropertyValue("--violet"));
}
async function timedFetch(url, options = {}) {
  const start = performance.now();
  const response = await fetch(`${url}${url.includes("?") ? "&" : "?"}cacheBust=${crypto.randomUUID()}`, { cache: "no-store", ...options });
  if (!response.ok) throw new Error(`Request failed (${response.status})`);
  return { response, elapsed: performance.now() - start };
}
async function measureDownload() {
  const started = performance.now();
  const requests = Array.from({ length: 4 }, (_, index) =>
    fetch(`https://speed.cloudflare.com/__down?bytes=8388608&stream=${index}&cacheBust=${crypto.randomUUID()}`, {
      cache: "no-store"
    }).then(async (response) => {
      if (!response.ok) throw new Error(`Download request failed (${response.status})`);
      return (await response.arrayBuffer()).byteLength;
    })
  );
  const sizes = await Promise.all(requests);
  const elapsed = performance.now() - started;
  return { mbps: sizes.reduce((sum, size) => sum + size, 0) * 8 / elapsed / 1000, elapsed };
}
async function measureUpload() {
  const payload = new Uint8Array(4 * 1024 * 1024);
  const started = performance.now();
  const requests = Array.from({ length: 4 }, () =>
    fetch(`https://speed.cloudflare.com/__up?cacheBust=${crypto.randomUUID()}`, {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/octet-stream" },
      body: payload
    }).then((response) => {
      if (!response.ok) throw new Error(`Upload request failed (${response.status})`);
      return response;
    })
  );
  await Promise.all(requests);
  const elapsed = performance.now() - started;
  return { mbps: payload.byteLength * requests.length * 8 / elapsed / 1000, elapsed };
}
async function measureLatency() {
  const samples = [];
  for (let i = 0; i < 3; i++) {
    const start = performance.now();
    await fetch(`/api/ping?cacheBust=${crypto.randomUUID()}`).catch(() => {});
    samples.push(performance.now() - start);
  }
  return Math.round(samples.reduce((sum, value) => sum + value, 0) / samples.length);
}
const buddy = { mood: "idle", speed: 0, t: 0, x: 0, trail: [] };
const buddyCanvas = $("#buddy-canvas");
const buddyCtx = buddyCanvas.getContext("2d");
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const buddyMoods = {
  idle: { tag: "Idle", caption: "Run a test and watch Buddy react to your Wi‑Fi." },
  testing: { tag: "Measuring", caption: "Buddy is warming up… stretching… hydrating…" },
  fast: { tag: "Zoomies", caption: "Blazing fast! Buddy is having the time of its life." },
  ok: { tag: "Cruising", caption: "Steady jog. Buddy approves of this connection." },
  slow: { tag: "Buffering", caption: "Buddy is stuck… buffering… sending thoughts and prayers." }
};
function setBuddyMood(mood, mbps) {
  buddy.mood = mood;
  buddy.speed = mbps ?? buddy.speed;
  setText("#buddy-mood-tag", buddyMoods[mood].tag);
  setText("#buddy-caption", buddyMoods[mood].caption);
}
function moodForSpeed(mbps) { return mbps >= 80 ? "fast" : mbps >= 20 ? "ok" : "slow"; }
function drawBuddy(time) {
  const rect = buddyCanvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  if (buddyCanvas.width !== Math.round(rect.width * dpr)) { buddyCanvas.width = rect.width * dpr; buddyCanvas.height = rect.height * dpr; }
  const ctx = buddyCtx; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const w = rect.width, h = rect.height, ground = h - 42;
  const dt = Math.min((time - (buddy.last || time)) / 1000, .05); buddy.last = time;
  if (!reducedMotion) buddy.t += dt;
  const { mood } = buddy;
  const pace = reducedMotion ? 0 : mood === "fast" ? 360 : mood === "ok" ? 150 : mood === "testing" ? 90 : mood === "idle" ? 40 : 6;
  buddy.x = (buddy.x + pace * dt) % (w + 120);
  const cx = mood === "slow" ? w * .5 + Math.sin(buddy.t * 30) * 2 : buddy.x - 40;
  ctx.clearRect(0, 0, w, h);

  // scrolling stars + hills give the sense of speed
  const scroll = reducedMotion ? 0 : buddy.t * pace;
  ctx.fillStyle = "rgba(255,255,255,.55)";
  for (let i = 0; i < 28; i++) {
    const sx = ((i * 97 - scroll * (.2 + (i % 3) * .1)) % w + w) % w;
    ctx.fillRect(sx, (i * 41) % (ground - 30), 1.6, 1.6);
  }
  ctx.fillStyle = "rgba(60,90,190,.35)";
  ctx.beginPath(); ctx.moveTo(0, ground);
  for (let x = 0; x <= w; x += 10) ctx.lineTo(x, ground - 14 - Math.sin((x + scroll * .4) / 38) * 9);
  ctx.lineTo(w, ground + 20); ctx.lineTo(0, ground + 20); ctx.fill();
  ctx.strokeStyle = "rgba(139,228,183,.5)"; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(0, ground + 14); ctx.lineTo(w, ground + 14); ctx.stroke();

  // speed lines for fast mode
  if (mood === "fast") {
    ctx.strokeStyle = "rgba(121,231,238,.5)";
    for (let i = 0; i < 6; i++) {
      const ly = ground - 60 + i * 11, lx = cx - 30 - ((buddy.t * 500 + i * 60) % 90);
      ctx.beginPath(); ctx.moveTo(lx, ly); ctx.lineTo(lx - 40, ly); ctx.stroke();
    }
  }

  // Buddy: a round glowing blob with legs
  const run = mood === "slow" ? 0 : buddy.t * (mood === "fast" ? 22 : mood === "ok" ? 10 : 7);
  const bounce = mood === "slow" ? 0 : Math.abs(Math.sin(run)) * (mood === "fast" ? 14 : 7);
  const squish = mood === "slow" ? 1 + Math.sin(buddy.t * 6) * .04 : 1;
  const by = ground - 22 - bounce;
  ctx.save(); ctx.translate(cx, by); ctx.scale(1 / squish, squish);
  ctx.strokeStyle = "#ffd27b"; ctx.lineWidth = 4; ctx.lineCap = "round";
  const legSwing = mood === "slow" ? 0 : Math.sin(run) * 12;
  ctx.beginPath(); ctx.moveTo(-8, 18); ctx.lineTo(-8 + legSwing, 32); ctx.moveTo(8, 18); ctx.lineTo(8 - legSwing, 32); ctx.stroke();
  const grad = ctx.createRadialGradient(-6, -8, 4, 0, 0, 26);
  grad.addColorStop(0, "#d8fbff"); grad.addColorStop(1, mood === "slow" ? "#8a9bd6" : "#79e7ee");
  ctx.fillStyle = grad; ctx.shadowColor = "rgba(121,231,238,.6)"; ctx.shadowBlur = mood === "slow" ? 4 : 18;
  ctx.beginPath(); ctx.arc(0, 0, 22, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0;
  ctx.fillStyle = "#07102e";
  if (mood === "slow") {
    // dizzy swirl eyes + wobbling tongue
    ctx.lineWidth = 1.6; ctx.strokeStyle = "#07102e";
    [-8, 8].forEach((ex) => { ctx.beginPath(); for (let a = 0; a < 9; a += .5) ctx.lineTo(ex + Math.cos(a + buddy.t * 8) * a * .7, -4 + Math.sin(a + buddy.t * 8) * a * .7); ctx.stroke(); });
    ctx.fillStyle = "#ff8fa3"; ctx.beginPath(); ctx.ellipse(0, 12 + Math.sin(buddy.t * 5) * 2, 4, 6, 0, 0, Math.PI * 2); ctx.fill();
  } else {
    ctx.beginPath(); ctx.arc(-7, -4, 2.6, 0, Math.PI * 2); ctx.arc(7, -4, 2.6, 0, Math.PI * 2); ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = "#07102e"; ctx.beginPath();
    ctx.arc(0, 3, mood === "fast" ? 9 : 6, 0.1 * Math.PI, 0.9 * Math.PI); ctx.stroke();
  }
  ctx.restore();

  // buffering ring / floating "..." for slow, sparkles for fast
  if (mood === "slow" || mood === "testing") {
    ctx.strokeStyle = "rgba(255,210,123,.85)"; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(cx, by - 46, 10, buddy.t * 5, buddy.t * 5 + Math.PI * 1.4); ctx.stroke();
  }
  if (mood === "fast") {
    ctx.fillStyle = "#ffd27b";
    for (let i = 0; i < 4; i++) { const a = buddy.t * 4 + i * 1.6; ctx.fillRect(cx + Math.cos(a) * 34, by - 20 + Math.sin(a) * 26, 3, 3); }
  }
  requestAnimationFrame(drawBuddy);
}
requestAnimationFrame(drawBuddy);

async function runTest() {
  if (state.testing) return;
  state.testing = true; $("#run-test").disabled = true; setBuddyMood("testing");
  setText("#connection-status", "Measuring connection…"); setText("#last-tested", "Working from this browser");
  try {
    setText("#connection-status", "Measuring latency…");
    const latency = await measureLatency();
    setText("#latency-value", latency); setText("#latency-quality", quality(latency, "latency")); setText("#latency-time", "3 samples");
    setText("#connection-status", "Measuring download…");
    const download = await measureDownload(); updateMetric("download", download.mbps, download.elapsed);
    setText("#connection-status", "Measuring upload…");
    const upload = await measureUpload(); updateMetric("upload", upload.mbps, upload.elapsed);
    history.push({ download: download.mbps, upload: upload.mbps, timestamp: Date.now() });
    while (history.length > HISTORY_LIMIT) history.shift();
    saveHistory();
    setBuddyMood(moodForSpeed(download.mbps), download.mbps);
    $("#empty-chart").hidden = true; drawHistory();
    setText("#connection-status", "Connection looks good"); setText("#last-tested", `Last tested at ${nowLabel()}`);
  } catch (error) {
    setText("#connection-status", "Test could not finish"); setText("#last-tested", error.message);
    setBuddyMood("slow");
  } finally { state.testing = false; $("#run-test").disabled = false; }
}
function readConnectionDetails() {
  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  setText("#network-type", connection?.type || "Wi-Fi / browser hidden");
  setText("#effective-type", connection?.effectiveType?.toUpperCase() || "Unavailable");
  setText("#browser-downlink", connection?.downlink ? `${connection.downlink} Mbps` : "Unavailable");
  setText("#browser-rtt", connection?.rtt ? `${connection.rtt} ms` : "Unavailable");
  setText("#online-since", navigator.onLine ? nowLabel() : "Offline");
}
$("#run-test").addEventListener("click", runTest);
window.addEventListener("resize", drawHistory);
$("#theme-toggle").addEventListener("click", () => { document.body.classList.toggle("light"); drawHistory(); });
readConnectionDetails(); window.addEventListener("online", readConnectionDetails); window.addEventListener("offline", readConnectionDetails);
if (history.length) {
  $("#empty-chart").hidden = true;
  drawHistory();
  setBuddyMood(moodForSpeed(history[history.length - 1].download), history[history.length - 1].download);
}
