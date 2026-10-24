// Gathers what goes INSIDE the installer: the old data (so the new PC starts with it)
// and the old-data PDF. Both come from ../offline-pack (kept out of git: real shop data).
const fs = require("fs");
const path = require("path");

const pack = path.join(__dirname, "..", "offline-pack");
const out = path.join(__dirname, "pack-data");
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, "initial-data"), { recursive: true });
fs.mkdirSync(path.join(out, "old-data"), { recursive: true });

const data = path.join(pack, "cuebill-data-backup.json");
if (!fs.existsSync(data)) {
  console.error("Nahi mila:", data, "\nPehle purane data ka backup is folder mein rakho.");
  process.exit(1);
}
fs.copyFileSync(data, path.join(out, "initial-data", "cuebill-data-backup.json"));

const pdfDir = path.join(pack, "Purana-Data-PDF");
const pdfs = fs.existsSync(pdfDir) ? fs.readdirSync(pdfDir).filter((f) => f.toLowerCase().endsWith(".pdf")) : [];
if (pdfs.length === 0) console.warn("Dhyan do: purane data ki PDF nahi mili (offline-pack/Purana-Data-PDF).");
for (const f of pdfs) fs.copyFileSync(path.join(pdfDir, f), path.join(out, "old-data", f));

fs.copyFileSync(path.join(__dirname, "..", "public", "icons", "icon-512.png"), path.join(__dirname, "icon.png"));
console.log(`Installer ke andar jayega: purana data + ${pdfs.length} PDF`);
