// Electron main process: window, menu, file dialogs, autosave and PDF output.
const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');

// The app was renamed from "Clothes Designer"; keep using its old data folder so autosave and recent files carry over.
app.setPath('userData', path.join(app.getPath('appData'), 'Clothes Designer'));

let win = null;
let pendingOpen = null;
const FILTER = [{ name: 'Made for Thea project', extensions: ['clothes'] }];
const userFile = (n) => path.join(app.getPath('userData'), n);
const readJSON = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };

function addRecent(p) {
  const list = readJSON(userFile('recent.json'), []).filter((x) => x !== p);
  list.unshift(p);
  fs.writeFileSync(userFile('recent.json'), JSON.stringify(list.slice(0, 10)));
}
function readProject(p) {
  const text = fs.readFileSync(p, 'utf8');
  addRecent(p);
  return { path: p, text };
}
const fileArg = (argv) => argv.find((a) => a.toLowerCase().endsWith('.clothes') && fs.existsSync(a));
const send = (ch, data) => win && win.webContents.send(ch, data);

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const menu = (cmd) => () => send('menu', cmd);
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(isMac ? [{ role: 'appMenu' }] : []),
    { label: 'File', submenu: [
      { label: 'New project', accelerator: 'CmdOrCtrl+N', click: menu('new') },
      { label: 'Open…', accelerator: 'CmdOrCtrl+O', click: menu('open') },
      { type: 'separator' },
      { label: 'Save', accelerator: 'CmdOrCtrl+S', click: menu('save') },
      { label: 'Save as…', accelerator: 'CmdOrCtrl+Shift+S', click: menu('saveAs') },
      { type: 'separator' },
      isMac ? { role: 'close' } : { role: 'quit' },
    ] },
    { role: 'editMenu' },
    { label: 'View', submenu: [{ role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }, { role: 'toggleDevTools' }] },
    { role: 'windowMenu' },
  ]));
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440, height: 920, minWidth: 1000, minHeight: 640,
    title: 'Made for Thea', backgroundColor: '#f7f4ef',
    icon: path.join(__dirname, 'src', 'assets', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  win.loadFile(path.join(__dirname, 'src', 'index.html'));
  win.on('closed', () => { win = null; });
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', (e, argv) => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
    const f = fileArg(argv);
    if (f) send('open-path', readProject(f));
  });
  app.on('open-file', (e, p) => { // macOS double-click on a .clothes file
    e.preventDefault();
    if (win) send('open-path', readProject(p)); else pendingOpen = p;
  });
  app.whenReady().then(() => {
    pendingOpen = pendingOpen || fileArg(process.argv);
    buildMenu();
    createWindow();
  });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
}

// Updates: compare with the newest release on GitHub; the download page opens in her browser.
const REPO = 'Andersx1/made-for-thea';
ipcMain.handle('version', () => app.getVersion());
ipcMain.handle('check-update', async () => {
  const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { 'User-Agent': 'Made-for-Thea' } });
  if (!r.ok) throw new Error(`GitHub answered ${r.status}`);
  const latest = (await r.json()).tag_name.replace(/^v/, ''), current = app.getVersion();
  return { current, latest, newer: latest.localeCompare(current, undefined, { numeric: true }) > 0 };
});
ipcMain.handle('open-releases', () => shell.openExternal(`https://github.com/${REPO}/releases/latest`));
ipcMain.handle('startup-file', () => { const p = pendingOpen; pendingOpen = null; return p ? readProject(p) : null; });
ipcMain.handle('open', async () => {
  const r = await dialog.showOpenDialog(win, { filters: FILTER, properties: ['openFile'] });
  return r.canceled ? null : readProject(r.filePaths[0]);
});
ipcMain.handle('open-recent', (e, p) => (fs.existsSync(p) ? readProject(p) : null));
ipcMain.handle('recent', () => readJSON(userFile('recent.json'), []).filter((p) => fs.existsSync(p)));
ipcMain.handle('save', async (e, { path: p, text, name }) => {
  if (!p) {
    const r = await dialog.showSaveDialog(win, { defaultPath: path.join(app.getPath('documents'), `${name}.clothes`), filters: FILTER });
    if (r.canceled) return null;
    p = r.filePath;
  }
  fs.writeFileSync(p, text);
  addRecent(p);
  return p;
});
ipcMain.handle('autosave-read', () => { try { return fs.readFileSync(userFile('autosave.clothes'), 'utf8'); } catch { return null; } });
ipcMain.handle('autosave-write', (e, text) => { fs.writeFileSync(userFile('autosave.clothes'), text); });
// Render the print HTML in a hidden window and save it as a PDF at exact page size.
ipcMain.handle('pdf', async (e, { html, name }) => {
  const tmp = path.join(os.tmpdir(), `clothes-print-${Date.now()}.html`);
  fs.writeFileSync(tmp, html);
  const w = new BrowserWindow({ show: false });
  try {
    await w.loadFile(tmp);
    const buf = await w.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true, margins: { marginType: 'none' } });
    const r = await dialog.showSaveDialog(win, { defaultPath: path.join(app.getPath('documents'), `${name}.pdf`), filters: [{ name: 'PDF', extensions: ['pdf'] }] });
    if (r.canceled) return null;
    fs.writeFileSync(r.filePath, buf);
    shell.openPath(r.filePath);
    return r.filePath;
  } finally {
    w.destroy();
    fs.rmSync(tmp, { force: true });
  }
});
