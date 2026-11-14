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
import struct, sys, zipfile
path, mode = sys.argv[1:]
abis = {'armeabi-v7a': (40, 1), 'arm64-v8a': (183, 2), 'x86': (3, 1), 'x86_64': (62, 2)}
libs = ('libreactnative.so', 'libc++_shared.so', 'libhermesvm.so', 'libhermestooling.so', 'libsplashmotion.so', 'libadditional.so')
prefix = 'lib' if path.endswith('.apk') else 'base/lib'
with zipfile.ZipFile(path, 'w') as archive:
    for abi, (machine, klass) in abis.items():
        for lib in libs:
            if mode == 'missing' and abi == 'x86_64' and lib == 'libreactnative.so': continue
            if mode == 'missing-tooling' and abi == 'x86_64' and lib == 'libhermestooling.so': continue
            size = 64 if klass == 2 else 52
            header = bytearray(size)
            header_size_offset = 52 if klass == 2 else 40
            program_header_offset_offset, program_header_count_offset, program_header_size_offset = (32, 56, 54) if klass == 2 else (28, 44, 42)
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
            if mode not in ('header-only', 'incomplete-extra') or abi != 'x86_64' or lib != ('libreactnative.so' if mode == 'header-only' else 'libadditional.so'):
                phoff = size
                phentsize = 56 if klass == 2 else 32
                phnum = 2
                dynamic_offset = phoff + phentsize * phnum
                dynamic_size = 16 if klass == 2 else 8
                file_size = dynamic_offset + dynamic_size
                header[program_header_offset_offset:program_header_offset_offset + (8 if klass == 2 else 4)] = phoff.to_bytes(8 if klass == 2 else 4, 'little')
                header[program_header_size_offset:program_header_size_offset + 2] = phentsize.to_bytes(2, 'little')
                header[program_header_count_offset:program_header_count_offset + 2] = phnum.to_bytes(2, 'little')
                if klass == 2:
                    load_type = 0 if mode == 'missing-load-64' else 1
                    dynamic_type = 0 if mode == 'missing-dynamic-64' else 2
                    dynamic_segment_offset = file_size + 1 if mode == 'out-of-bounds-64' else dynamic_offset
                    dynamic_segment_size = 1 if mode == 'out-of-bounds-64' else dynamic_size
                    load = struct.pack('<IIQQQQQQ', load_type, 5, 0, 0, 0, file_size, file_size, 4096)
                    dynamic = struct.pack('<IIQQQQQQ', dynamic_type, 6, dynamic_segment_offset, 0, 0, dynamic_segment_size, dynamic_segment_size, 8)
                    dynamic_terminator = struct.pack('<QQ', 0, 0)
                else:
                    load_type = 0 if mode == 'missing-load-32' else 1
                    dynamic_type = 0 if mode == 'missing-dynamic-32' else 2
                    dynamic_segment_offset = file_size + 1 if mode == 'out-of-bounds-32' else dynamic_offset
                    dynamic_segment_size = 1 if mode == 'out-of-bounds-32' else dynamic_size
                    load = struct.pack('<IIIIIIII', load_type, 0, 0, 0, file_size, file_size, 5, 4096)
                    dynamic = struct.pack('<IIIIIIII', dynamic_type, dynamic_segment_offset, 0, 0, dynamic_segment_size, dynamic_segment_size, 6, 4)
                    dynamic_terminator = struct.pack('<II', 0, 0)
                image = header + load + dynamic + dynamic_terminator
            else:
                image = header
            archive.writestr(f'{prefix}/{abi}/{lib}', image[:20] if mode == 'truncated' else image)
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
test('rejects an ELF header with no loadable or dynamic library segments', () => {
  const result = run(fixture('header-only.aab', 'header-only'));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /invalid or incomplete ELF program header table/);
});
test('checks loadable segments for every packaged native library', () => {
  const result = run(fixture('incomplete-extra.aab', 'incomplete-extra'));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /x86_64\/libadditional\.so: invalid or incomplete ELF program header table/);
});
for (const [mode, expected] of [
  ['missing-load-32', /missing ELF PT_LOAD segment/],
  ['missing-dynamic-64', /missing ELF PT_DYNAMIC segment/],
  ['out-of-bounds-32', /invalid ELF load or dynamic segment bounds/],
  ['out-of-bounds-64', /invalid ELF load or dynamic segment bounds/],
]) {
  test(`rejects valid-table ELF with ${mode}`, () => {
    const result = run(fixture(`${mode}.aab`, mode));
    assert.equal(result.status, 1);
    assert.match(result.stderr, expected);
  });
}
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
