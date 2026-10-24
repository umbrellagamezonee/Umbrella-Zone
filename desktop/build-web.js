// Builds the web app for the offline desktop version into desktop/app-dist.
//   node build-web.js
// It is the normal build, except: no PWA/service worker, and the cloud (Supabase)
// is switched off no matter what keys exist on this machine.
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const out = path.join(__dirname, "app-dist");
const env = {
  ...process.env,
  CUEBILL_DESKTOP: "1",
  VITE_DESKTOP: "1",
  VITE_SUPABASE_URL: "",
  VITE_SUPABASE_ANON_KEY: "",
};

function run(bin, args) {
  const r = spawnSync(process.execPath, [path.join(root, "node_modules", ...bin), ...args], { cwd: root, env, stdio: "inherit" });
  if (r.status !== 0) {
    console.error("Build fail ho gaya:", bin.join("/"), args.join(" "));
    process.exit(r.status || 1);
  }
}

fs.rmSync(out, { recursive: true, force: true });
run(["typescript", "bin", "tsc"], ["-b"]);
run(["vite", "bin", "vite.js"], ["build", "--outDir", out, "--emptyOutDir"]);

// things the website needs but the installed app does not
fs.rmSync(path.join(out, "downloads"), { recursive: true, force: true });
fs.rmSync(path.join(out, "_redirects"), { force: true });

// the build must not contain this shop's cloud address
let host = null;
try {
  const m = /^VITE_SUPABASE_URL=(.+)$/m.exec(fs.readFileSync(path.join(root, ".env.local"), "utf8"));
  if (m) host = new URL(m[1].trim()).host;
} catch {
  /* no .env.local - nothing to look for */
}
const leak = [];
if (host) {
  (function scan(dir) {
    for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, f.name);
      if (f.isDirectory()) scan(p);
      else if (/.(js|html|css)$/.test(f.name) && fs.readFileSync(p, "utf8").includes(host)) leak.push(p);
    }
  })(out);
}
if (leak.length) {
  console.error("Cloud address mila build mein:", leak);
  process.exit(1);
}
console.log("Web app ready:", out);
