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
// This packaging check verifies library presence, ELF architecture, and that
// each native library contains bounded loadable and dynamic segments. Dynamic
// symbol compatibility still requires a runtime device check.
const python = String.raw`
import struct, sys, zipfile
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
            native_prefix = f'{prefix}/{abi}/'
            packaged_libraries = sorted({name for name in names if name.startswith(native_prefix) and name.endswith('.so')})
            for path in packaged_libraries:
                if names.count(path) != 1:
                    raise ValueError(f'{path}: expected exactly one entry')
                header_size, header_size_offset = (64, 52) if elf_class == 2 else (52, 40)
                program_header_offset_offset, program_header_count_offset, program_header_size_offset = (32, 56, 54) if elf_class == 2 else (28, 44, 42)
                expected_program_header_size = 56 if elf_class == 2 else 32
                entry_file_size = archive.getinfo(path).file_size
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
                    program_header_offset = int.from_bytes(header[program_header_offset_offset:program_header_offset_offset + (8 if elf_class == 2 else 4)], 'little')
                    program_header_size = int.from_bytes(header[program_header_size_offset:program_header_size_offset + 2], 'little')
                    program_header_count = int.from_bytes(header[program_header_count_offset:program_header_count_offset + 2], 'little')
                    program_headers_end = program_header_offset + program_header_size * program_header_count
                    if program_header_offset < header_size or program_header_size != expected_program_header_size or program_header_count < 2 or program_headers_end > entry_file_size:
                        raise ValueError(f'{path}: invalid or incomplete ELF program header table for {abi}')
                    entry.seek(program_header_offset)
                    program_headers = entry.read(program_header_size * program_header_count)
                    if len(program_headers) != program_header_size * program_header_count:
                        raise ValueError(f'{path}: incomplete ELF program header table for {abi}')
                    has_loadable_segment = False
                    has_dynamic_segment = False
                    for index in range(program_header_count):
                        start = index * program_header_size
                        raw_header = program_headers[start:start + program_header_size]
                        if elf_class == 2:
                            segment_type, _, segment_offset, _, _, file_size, memory_size, _ = struct.unpack('<IIQQQQQQ', raw_header)
                        else:
                            segment_type, segment_offset, _, _, file_size, memory_size, _, _ = struct.unpack('<IIIIIIII', raw_header)
                        if segment_type in (1, 2) and (file_size > memory_size or segment_offset + file_size > entry_file_size):
                            raise ValueError(f'{path}: invalid ELF load or dynamic segment bounds for {abi}')
                        if segment_type == 1 and file_size > 0:
                            has_loadable_segment = True
                        if segment_type == 2 and file_size > 0:
                            has_dynamic_segment = True
                    if not has_loadable_segment:
                        raise ValueError(f'{path}: missing ELF PT_LOAD segment for {abi}')
                    if not has_dynamic_segment:
                        raise ValueError(f'{path}: missing ELF PT_DYNAMIC segment for {abi}')
    print('Native library packaging and architecture check passed for ' + ', '.join(abis))
except (OSError, ValueError, zipfile.BadZipFile) as error:
    print(f'Native library packaging and architecture check failed: {error}', file=sys.stderr)
    sys.exit(1)
`;
const result = spawnSync('python3', ['-c', python, artifact, extension === '.aab' ? 'base/lib' : 'lib', ...abis], { stdio: 'inherit' });
if (result.error) console.error(`Unable to run native library check: ${result.error.message}`);
process.exit(result.status ?? 1);
