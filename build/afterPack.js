// Stamps the icon + version info into the Windows exe after packing.
// electron-builder's own step needs 32-bit Wine on Linux; this uses rcedit-x64 instead,
// which runs under plain 64-bit Wine. On Windows, rcedit runs natively.
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

function findRcedit() {
  const cache = process.env.ELECTRON_BUILDER_CACHE ||
    (process.platform === 'win32'
      ? path.join(process.env.LOCALAPPDATA || '', 'electron-builder', 'Cache')
      : path.join(os.homedir(), '.cache', 'electron-builder'));
  const dir = path.join(cache, 'winCodeSign');
  if (!fs.existsSync(dir)) return null;
  for (const v of fs.readdirSync(dir).sort().reverse()) {
    const p = path.join(dir, v, 'rcedit-x64.exe');
    if (fs.existsSync(p)) return p;
  }
  return null;
}

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return;
  const { productFilename, info } = context.packager.appInfo;
  const exe = path.join(context.appOutDir, `${productFilename}.exe`);
  const icon = path.join(context.packager.projectDir, 'assets', 'icon.ico');
  const version = info._metadata.version;

  const rcedit = findRcedit();
  if (!rcedit) {
    console.warn('  • afterPack: rcedit-x64.exe not found in the electron-builder cache, icon not set');
    return;
  }
  const args = [
    exe,
    '--set-icon', icon,
    '--set-file-version', version,
    '--set-product-version', version,
    '--set-version-string', 'ProductName', 'Panel Peek',
    '--set-version-string', 'FileDescription', 'Panel Peek',
    '--set-version-string', 'InternalName', 'Panel Peek',
    '--set-version-string', 'OriginalFilename', `${productFilename}.exe`,
    '--set-version-string', 'LegalCopyright', `© ${new Date().getFullYear()} AchBs`,
  ];
  if (process.platform === 'win32') execFileSync(rcedit, args, { stdio: 'inherit' });
  else execFileSync('wine', [rcedit, ...args], { stdio: 'inherit', env: { ...process.env, WINEDEBUG: '-all' } });
  console.log('  • afterPack: icon + version info stamped into', path.basename(exe));
};
