// The only thing the app page gets from the desktop shell: a way to read and save
// its data files, and to save the current screen as a PDF. index.html turns this
// into the app's "localStorage" before the app starts.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("__cuebillStorage", {
  // everything saved so far: { key: "value" }
  load: () => ipcRenderer.sendSync("storage:load"),
  // batch: { key: "value" | null }. sync = wait until it is on disk (used when closing / reloading).
  save: (batch, sync) => {
    if (sync) ipcRenderer.sendSync("storage:save-sync", batch);
    else ipcRenderer.send("storage:save", batch);
  },
  printPdf: () => ipcRenderer.send("print-pdf"),
});
