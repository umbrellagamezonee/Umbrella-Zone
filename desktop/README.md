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
