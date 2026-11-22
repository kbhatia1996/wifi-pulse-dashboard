import crypto from "node:crypto";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

const app = express();
const port = Number(process.env.PORT) || 10000;
const root = path.dirname(fileURLToPath(import.meta.url));

app.use(express.static(path.join(root, "public"), { extensions: ["html"] }));

app.get("/api/download", (req, res) => {
  const requestedBytes = Number(req.query.bytes);
  const bytes = Number.isFinite(requestedBytes)
    ? Math.min(Math.max(Math.floor(requestedBytes), 256 * 1024), 25 * 1024 * 1024)
    : 8 * 1024 * 1024;
  const chunk = crypto.randomBytes(64 * 1024);

  res.set({
    "Cache-Control": "no-store, no-cache, must-revalidate",
    "Content-Length": String(bytes),
    "Content-Type": "application/octet-stream",
    "X-Content-Type-Options": "nosniff"
  });

  let remaining = bytes;
  const write = () => {
    while (remaining > 0) {
      const current = chunk.subarray(0, Math.min(remaining, chunk.length));
      remaining -= current.length;
      if (!res.write(current)) {
        res.once("drain", write);
        return;
      }
    }
    res.end();
  };
  write();
});

app.post("/api/upload", express.raw({ type: "*/*", limit: "25mb" }), (req, res) => {
  res.set({
    "Cache-Control": "no-store",
    "Content-Type": "application/json",
    "X-Content-Type-Options": "nosniff"
  });
  res.json({ bytes: req.body.length });
});

app.get("/api/ping", (req, res) => {
  res.set({
    "Cache-Control": "no-store",
    "Content-Type": "application/json",
    "X-Content-Type-Options": "nosniff"
  });
  res.json({ ok: true });
});

app.get("/{*splat}", (req, res) => {
  res.sendFile(path.join(root, "public", "index.html"));
});

app.listen(port, "0.0.0.0", () => {
  console.log(`Wi-Fi Pulse listening on port ${port}`);
});
