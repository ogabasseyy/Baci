import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const normalize = (symbol) => symbol.trim().replace(/^_/, '');
const isJsi = (symbol) => /^\$s14ExpoModulesJSI/.test(symbol);

// Dynamic imports must be satisfied by the shipped provider, not a header or
// cached framework from the machine that linked the archive.
export function missingExpoJsiSymbols(binaries) {
  const exports = new Set(binaries.filter((binary) => binary.name === 'ExpoModulesJSI').flatMap((binary) => binary.definedSymbols.map(normalize)));
  return binaries.flatMap((binary) => binary.undefinedSymbols
    .map(normalize)
    .filter((symbol) => isJsi(symbol) && !exports.has(symbol))
    .map((symbol) => `${binary.name}: ${symbol}`));
}

function verifyIpa(ipa) {
  const folder = mkdtempSync(join(tmpdir(), 'baci-ipa-abi-'));
  try {
    execFileSync('/usr/bin/ditto', ['-x', '-k', resolve(ipa), folder]);
    const payload = join(folder, 'Payload');
    const apps = readdirSync(payload).filter((entry) => entry.endsWith('.app'));
    if (apps.length !== 1) throw new Error('Expected exactly one app in IPA Payload');
    const app = join(payload, apps[0]);
    const executable = execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleExecutable', join(app, 'Info.plist')], { encoding: 'utf8' }).trim();
    const paths = [join(app, executable)];
    const frameworks = join(app, 'Frameworks');
    if (existsSync(frameworks)) {
      for (const entry of readdirSync(frameworks)) {
        if (entry.endsWith('.framework')) paths.push(join(frameworks, entry, basename(entry, '.framework')));
      }
    }
    const symbols = (path, flags) => execFileSync('xcrun', ['nm', '-arch', 'arm64', ...flags, path], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
      .split('\n').filter(Boolean);
    const binaries = paths.map((path) => ({ name: basename(path),
      undefinedSymbols: symbols(path, ['-u', '-j']),
      definedSymbols: symbols(path, ['-g', '-U', '-j']),
    }));
    const missing = missingExpoJsiSymbols(binaries);
    if (missing.length) throw new Error(`Unresolved ExpoModulesJSI imports in shipped IPA:\n${missing.join('\n')}`);
    console.log(`ExpoModulesJSI ABI check passed for ${paths.length} packaged arm64 binaries`);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) throw new Error('Usage: node verify-ios-expo-jsi-symbols.mjs <archive.ipa>');
  verifyIpa(process.argv[2]);
}
