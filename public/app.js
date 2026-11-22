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
async function runTest() {
  if (state.testing) return;
  state.testing = true; $("#run-test").disabled = true;
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
    $("#empty-chart").hidden = true; drawHistory();
    setText("#connection-status", "Connection looks good"); setText("#last-tested", `Last tested at ${nowLabel()}`);
  } catch (error) {
    setText("#connection-status", "Test could not finish"); setText("#last-tested", error.message);
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
}
