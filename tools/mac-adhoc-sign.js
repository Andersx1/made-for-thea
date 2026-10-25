// electron-builder afterPack hook: ad-hoc sign the Mac app (free, no Apple certificate). Without any
// signature, Apple-silicon Macs won't start the app properly (it bounces in the Dock and never opens).
const { execFileSync } = require('child_process');
const path = require('path');

exports.default = async ({ electronPlatformName, appOutDir, packager }) => {
  if (electronPlatformName !== 'darwin') return;
  // The Intel and Apple-silicon halves of the universal app are packed into *-temp folders first and must
  // stay identical for merging; only the merged app is signed.
  if (appOutDir.endsWith('-temp')) return;
  const app = path.join(appOutDir, `${packager.appInfo.productFilename}.app`);
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' });
  execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' });
};
