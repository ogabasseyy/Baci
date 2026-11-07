import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, test } from 'node:test';

const directory = mkdtempSync(join(tmpdir(), 'android-abi-check-'));
after(() => rmSync(directory, { recursive: true, force: true }));
const script = join(dirname(fileURLToPath(import.meta.url)), 'android-native-library-check.mjs');
function fixture(name, mode) {
  const path = join(directory, name);
  const generator = String.raw`
import sys, zipfile
path, mode = sys.argv[1:]
abis = {'armeabi-v7a': (40, 1), 'arm64-v8a': (183, 2), 'x86': (3, 1), 'x86_64': (62, 2)}
libs = ('libreactnative.so', 'libc++_shared.so', 'libhermesvm.so', 'libsplashmotion.so')
prefix = 'lib' if path.endswith('.apk') else 'base/lib'
with zipfile.ZipFile(path, 'w') as archive:
    for abi, (machine, klass) in abis.items():
        for lib in libs:
            if mode == 'missing' and abi == 'x86_64' and lib == 'libreactnative.so': continue
            header = bytearray(20)
            header[:4] = b'\x7fELF'
            header[4:6] = bytes((klass, 1))
            header[18:20] = (183 if mode == 'wrong' and abi == 'x86_64' and lib == 'libc++_shared.so' else machine).to_bytes(2, 'little')
            archive.writestr(f'{prefix}/{abi}/{lib}', header)
`;
  const result = spawnSync('python3', ['-c', generator, path, mode], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return path;
}
function run(...args) { return spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' }); }
test('valid AAB checks all four supported architectures', () => {
  assert.equal(run(fixture('valid.aab', 'valid')).status, 0);
});
test('fails closed on missing native library', () => {
  const result = run(fixture('missing.aab', 'missing'));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /x86_64\/libreactnative\.so/);
});
test('fails on wrong ELF machine', () => {
  const result = run(fixture('wrong.aab', 'wrong'));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /x86_64\/libc\+\+_shared\.so/);
});
test('APK requires explicit architecture selection', () => {
  const apk = fixture('valid.apk', 'valid');
  assert.equal(run(apk).status, 2);
  assert.equal(run(apk, '--abis', 'arm64-v8a').status, 0);
});
