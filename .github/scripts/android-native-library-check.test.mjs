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
libs = ('libreactnative.so', 'libc++_shared.so', 'libhermesvm.so', 'libhermestooling.so', 'libsplashmotion.so')
prefix = 'lib' if path.endswith('.apk') else 'base/lib'
with zipfile.ZipFile(path, 'w') as archive:
    for abi, (machine, klass) in abis.items():
        for lib in libs:
            if mode == 'missing' and abi == 'x86_64' and lib == 'libreactnative.so': continue
            if mode == 'missing-tooling' and abi == 'x86_64' and lib == 'libhermestooling.so': continue
            size = 64 if klass == 2 else 52
            header = bytearray(size)
            header_size_offset = 52 if klass == 2 else 40
            header[:4] = b'\x7fELF'
            header[4:7] = bytes((klass, 1, 1))
            header[16:18] = (2 if mode == 'executable' else 3).to_bytes(2, 'little')
            header[20:24] = (1).to_bytes(4, 'little')
            header[header_size_offset:header_size_offset + 2] = size.to_bytes(2, 'little')
            header[18:20] = (183 if mode == 'wrong' and abi == 'x86_64' and lib == 'libc++_shared.so' else machine).to_bytes(2, 'little')
            if abi == 'x86_64' and lib == 'libreactnative.so':
                if mode == 'ident-version': header[6] = 0
                if mode == 'elf-version': header[20] = 0
                if mode == 'header-size': header[header_size_offset] = 0
            archive.writestr(f'{prefix}/{abi}/{lib}', header[:20] if mode == 'truncated' else header)
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
test('rejects a missing Hermes tooling library', () => {
  const result = run(fixture('missing-tooling.aab', 'missing-tooling'));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /x86_64\/libhermestooling\.so/);
});
test('rejects incomplete ELF headers', () => {
  const result = run(fixture('truncated.aab', 'truncated'));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /ELF header/);
});
for (const mode of ['ident-version', 'elf-version', 'header-size']) {
  test(`rejects invalid ELF ${mode}`, () => {
    const result = run(fixture(`${mode}.aab`, mode));
    assert.equal(result.status, 1);
    assert.match(result.stderr, /libreactnative\.so: invalid ELF header size or version for x86_64/);
  });
}
test('rejects executable ELF objects in native library entries', () => {
  const result = run(fixture('executable.aab', 'executable'));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /shared object/);
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
test('trims whitespace around selected APK architectures', () => {
  const apk = fixture('valid-whitespace.apk', 'valid');
  assert.equal(run(apk, '--abis', ' arm64-v8a, x86_64 ').status, 0);
});
