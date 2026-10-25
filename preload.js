// Bridges the page to the main process. The page only gets these few functions.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('native', {
  open: () => ipcRenderer.invoke('open'),
  openRecent: (p) => ipcRenderer.invoke('open-recent', p),
  recent: () => ipcRenderer.invoke('recent'),
  save: (o) => ipcRenderer.invoke('save', o),
  autosaveRead: () => ipcRenderer.invoke('autosave-read'),
  autosaveWrite: (t) => ipcRenderer.invoke('autosave-write', t),
  pdf: (o) => ipcRenderer.invoke('pdf', o),
  startupFile: () => ipcRenderer.invoke('startup-file'),
  version: () => ipcRenderer.invoke('version'),
  checkUpdate: () => ipcRenderer.invoke('check-update'),
  openReleases: () => ipcRenderer.invoke('open-releases'),
  onOpenPath: (f) => ipcRenderer.on('open-path', (e, d) => f(d)),
  onMenu: (f) => ipcRenderer.on('menu', (e, cmd) => f(cmd)),
});
