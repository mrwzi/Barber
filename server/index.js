import path from "node:path";
import express from "express";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
loadEnv(path.join(root, ".env"));

const { createApp } = await import("./app.js");
const app = await createApp();
const dist = path.join(root, "dist");

app.use(express.static(dist));
app.get(/.*/, (_req, res) => res.sendFile(path.join(dist, "index.html")));

const port = process.env.PORT || 4173;
app.listen(port, () => {
  console.log(`Barber Mohamad running at http://127.0.0.1:${port}`);
});

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}
