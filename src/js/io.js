// Desktop app (Electron) file access, with browser fallbacks so the UI also runs in a normal browser.
const N = window.native;
export const isApp = !!N;

export function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
export function openProject() {
  if (N) return N.open();
  return new Promise((res) => {
    const i = document.createElement('input');
    i.type = 'file'; i.accept = '.clothes,.json';
    i.onchange = async () => res(i.files[0] ? { path: null, text: await i.files[0].text() } : null);
    i.click();
  });
}
export async function saveProject(text, name, path) {
  if (N) return N.save({ text, name, path });
  download(new Blob([text], { type: 'application/json' }), `${name}.clothes`);
  return null;
}
export async function autosaveRead() { if (N) return N.autosaveRead(); try { return localStorage.getItem('clothes-autosave'); } catch { return null; } }
export async function autosaveWrite(t) { if (N) return N.autosaveWrite(t); try { localStorage.setItem('clothes-autosave', t); } catch { /* storage full or blocked */ } }
export const recent = () => (N ? N.recent() : Promise.resolve([]));
export const openRecent = (p) => N.openRecent(p);
export const startupFile = () => (N ? N.startupFile() : Promise.resolve(null));
export const onOpenPath = (f) => N && N.onOpenPath(f);
export const onMenu = (f) => N && N.onMenu(f);
export const version = () => N.version();
export const checkUpdate = () => N.checkUpdate();
export const openReleases = () => N.openReleases();

export async function makePDF(html, name) {
  if (N) return N.pdf({ html, name });
  const w = window.open('', '_blank');
  if (!w) { alert('Please allow pop-ups so the print view can open.'); return null; }
  w.document.write(html); w.document.close();
  setTimeout(() => w.print(), 600);
  return null;
}
