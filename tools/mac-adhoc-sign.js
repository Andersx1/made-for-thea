// electron-builder afterPack hook: ad-hoc sign the Mac app (free, no Apple certificate). Without any
// signature, Apple-silicon Macs won't start the app properly (it bounces in the Dock and never opens).
const { execFileSync } = require('child_process');
const path = require('path');

exports.default = async ({ electronPlatformName, appOutDir, packager }) => {
  if (electronPlatformName !== 'darwin') return;
  const app = path.join(appOutDir, `${packager.appInfo.productFilename}.app`);
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' });
  execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' });
};
