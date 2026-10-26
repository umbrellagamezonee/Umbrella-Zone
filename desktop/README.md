# CueBill - offline Windows version

The same app, wrapped in Electron: no server, no internet, one PC. Everything it saves
is kept as files in `C:\CueBill-Data` (see `storage.js`); nothing leaves the PC.

| File | What it does |
| --- | --- |
| `main.js` | Opens the app from its own files (`app://` address), refuses every http/https request, keeps the data folder, makes daily backups, Excel/PDF downloads |
| `preload.js` | The small bridge the page uses to read/save data (turned into `localStorage` by the script at the top of `../index.html`) |
| `storage.js` | One file per saved item, written atomically, previous copy kept, automatic repair from the previous copy / latest backup |
| `build-web.js` | Builds the web app for the desktop (no PWA, cloud switched off) into `app-dist/` |
| `prepare-pack.js` | Copies the old data + old-data PDF from `../offline-pack` (git-ignored, real shop data) into the installer |
| `test-storage.js` | `node test-storage.js` - checks the data files logic |
| `test-app.js` | `node test-app.js [--exe path\CueBill.exe]` - starts the real app on a scratch data folder and checks data load, no network, Excel/PDF, write survival after close and kill, repair, Restore |
| `test-billing.js` | `node test-billing.js [--exe ...]` - the new billing end to end: Gaming and Canteen on one bill paid separately, Customer Bill, credit only for regulars, Credits / ledger split, business-wise reports and Excel |
| `e2e-lib.js` | helpers the two app tests share (start the app, drive it through its debug port) |

## Rebuild the installer

```
cd desktop
npm install                 # once (if electron did not download: node node_modules/electron/install.js)
npm run pack                # web build + pack data + installer -> release\CueBill-Setup-<version>.exe
```

Notes from the first build on this PC:
- `C:` was nearly full, so set `ELECTRON_CACHE`, `ELECTRON_BUILDER_CACHE` and `npm_config_cache` to folders on `A:` (e.g. `desktop/.cache/...`).
- `icon.ico` is checked in because electron-builder's own icon converter needs more memory than that PC had.
- The installer is not code-signed, so Windows SmartScreen shows "Windows protected your PC" -> More info -> Run anyway.
- Do not test-install on a PC that has the Chrome "CueBill" app shortcut on the Desktop: the installer's Desktop shortcut has the same name and replaces it (the uninstaller then deletes it).

## Checks on the old data (tools/credit-report)

Run from `tools/credit-report` against `offline-pack/cuebill-data-backup.json`:

- `npx tsx regress.ts snapshot out.json` once (before changing any report code), then `npx tsx regress.ts compare out.json` after: every old-data number must be exactly the same (new fields may appear).
- `npx tsx business-check.ts`: Gaming + Canteen add up to the galla on every old day, per bill, and the new-bill rules (discount, trimming, ledger split, regular customers) behave.
- `npx tsx audit-math.ts`: the maths worked out again from the raw bills with its own code (not billing.ts) and compared with the app - day by day, per customer, plus 50,000 random bills through the payment screen's arithmetic. Run this after ANY change to billing/report code.
- `npx tsx merge-check.ts`: bringing another laptop's backup in (Settings -> Backup & Restore -> "Dusre laptop ka data jodo", logic in src/lib/mergeBackup.ts): nothing lost, nothing counted twice, same result either way round.
- `npx tsx archive.ts`: the whole old data as one PDF (goes into the installer).
