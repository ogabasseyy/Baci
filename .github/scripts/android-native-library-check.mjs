#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { extname } from 'node:path';

const [artifact, flag, abiArgument, ...rest] = process.argv.slice(2);
const knownAbis = ['armeabi-v7a', 'arm64-v8a', 'x86', 'x86_64'];
if (!artifact || rest.length || (flag && flag !== '--abis') || (flag && !abiArgument) || (!flag && abiArgument)) {
  console.error('Usage: node android-native-library-check.mjs <artifact.aab|artifact.apk> [--abis abi,abi]');
  process.exit(2);
}
const extension = extname(artifact).toLowerCase();
const abis = flag ? abiArgument.split(',').map((abi) => abi.trim()) : knownAbis;
if (!['.aab', '.apk'].includes(extension) || (extension === '.apk' && !flag) || !abis.length || new Set(abis).size !== abis.length || abis.some((abi) => !knownAbis.includes(abi))) {
  console.error('Invalid artifact or ABI list; APK verification requires explicit --abis.');
  process.exit(2);
}
// This packaging check verifies library presence and ELF architecture headers.
// Dynamic linking and symbol compatibility require separate runtime checks.
const python = String.raw`
import sys, zipfile
artifact, prefix, *abis = sys.argv[1:]
machines = {'armeabi-v7a': (40, 1), 'arm64-v8a': (183, 2), 'x86': (3, 1), 'x86_64': (62, 2)}
libraries = ('libreactnative.so', 'libc++_shared.so', 'libhermesvm.so', 'libhermestooling.so', 'libsplashmotion.so')
try:
    with zipfile.ZipFile(artifact) as archive:
        names = archive.namelist()
        for abi in abis:
            machine, elf_class = machines[abi]
            for library in libraries:
                path = f'{prefix}/{abi}/{library}'
                if names.count(path) != 1:
                    raise ValueError(f'{path}: expected exactly one entry')
                header_size, header_size_offset = (64, 52) if elf_class == 2 else (52, 40)
                with archive.open(path) as entry:
                    header = entry.read(header_size)
                if len(header) != header_size:
                    raise ValueError(f'{path}: incomplete ELF header for {abi}')
                if header[:4] != b'\x7fELF' or header[4] != elf_class or header[5] != 1 or int.from_bytes(header[18:20], 'little') != machine:
                    raise ValueError(f'{path}: invalid ELF class, byte order, or machine for {abi}')
                if header[6] != 1 or int.from_bytes(header[20:24], 'little') != 1 or int.from_bytes(header[header_size_offset:header_size_offset + 2], 'little') != header_size:
                    raise ValueError(f'{path}: invalid ELF header size or version for {abi}')
                if int.from_bytes(header[16:18], 'little') != 3:
                    raise ValueError(f'{path}: ELF entry is not a shared object for {abi}')
    print('Native library packaging and architecture check passed for ' + ', '.join(abis))
except (OSError, ValueError, zipfile.BadZipFile) as error:
    print(f'Native library packaging and architecture check failed: {error}', file=sys.stderr)
    sys.exit(1)
`;
const result = spawnSync('python3', ['-c', python, artifact, extension === '.aab' ? 'base/lib' : 'lib', ...abis], { stdio: 'inherit' });
if (result.error) console.error(`Unable to run native library check: ${result.error.message}`);
process.exit(result.status ?? 1);
