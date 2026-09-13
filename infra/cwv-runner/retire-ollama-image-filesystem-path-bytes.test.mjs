import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const helper = new URL('./retire-ollama-image-filesystem.pl', import.meta.url);

function octal(value, width, suffix = '\0') {
  return `${value.toString(8).padStart(width - suffix.length, '0')}${suffix}`;
}
function tarEntry({ name, prefix = '', type = '0', bytes = Buffer.alloc(0) }) {
  const header = Buffer.alloc(512);
  Buffer.from(name).copy(header, 0, 0, 100);
  Buffer.from(prefix).copy(header, 345, 0, 155);
  header.write(octal(0o644, 8), 100);
  header.write(octal(0, 8), 108);
  header.write(octal(0, 8), 116);
  header.write(octal(bytes.length, 12), 124);
  header.fill(0x20, 148, 156);
  header[156] = type.charCodeAt(0);
  header.write('ustar\0', 257, 'ascii');
  header.write('00', 263, 'ascii');
  header.write(
    octal(
      header.reduce((sum, byte) => sum + byte, 0),
      8,
      '\0 '
    ),
    148
  );
  return Buffer.concat([
    header,
    bytes,
    Buffer.alloc((512 - (bytes.length % 512)) % 512),
  ]);
}
function rawLayer(entries) {
  return Buffer.concat([...entries, Buffer.alloc(1024)]);
}
function paxRecord(key, value) {
  const body = Buffer.concat([
    Buffer.from(`${key}=`),
    Buffer.isBuffer(value) ? value : Buffer.from(value),
    Buffer.from('\n'),
  ]);
  let length = body.length + 2;
  while (true) {
    const next = String(length).length + 1 + body.length;
    if (next === length)
      return Buffer.concat([Buffer.from(`${length} `), body]);
    length = next;
  }
}
function imageArchive(layer) {
  const layers = Array.isArray(layer) ? layer : [layer];
  return rawLayer([
    ...layers.map((bytes, index) =>
      tarEntry({ name: `layer-${index}.tar`, bytes })
    ),
    tarEntry({
      name: 'manifest.json',
      bytes: Buffer.from(
        JSON.stringify([
          {
            Config: 'config.json',
            Layers: layers.map((_bytes, index) => `layer-${index}.tar`),
          },
        ])
      ),
    }),
  ]);
}
async function project(layer) {
  const directory = await mkdtemp(join(tmpdir(), 'baci-image-path-bytes-'));
  const archive = join(directory, 'image.tar');
  try {
    await writeFile(archive, imageArchive(layer), { mode: 0o600 });
    return await execFileAsync('/usr/bin/perl', [
      helper.pathname,
      archive,
      directory,
    ]);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
}

test('PAX path override replaces the complete USTAR name and prefix', async () => {
  const result = await project(
    rawLayer([
      tarEntry({
        name: 'pax',
        type: 'x',
        bytes: paxRecord('path', 'etc/clean'),
      }),
      tarEntry({ name: 'name', prefix: 'ollama', bytes: Buffer.from('clean') }),
    ])
  );
  assert.equal(result.stdout.trim(), '0');
});

test('preserves a USTAR prefix whose value is the string zero', async () => {
  const result = await project([
    rawLayer([
      tarEntry({ name: 'target', prefix: '0', bytes: Buffer.from('ollama') }),
    ]),
    rawLayer([tarEntry({ name: '0/.wh.target' })]),
  ]);
  assert.equal(result.stdout.trim(), '0');
});

test('GNU longname override replaces the complete USTAR name and prefix', async () => {
  const result = await project(
    rawLayer([
      tarEntry({ name: 'long', type: 'L', bytes: Buffer.from('etc/clean\0') }),
      tarEntry({ name: 'name', prefix: 'ollama', bytes: Buffer.from('clean') }),
    ])
  );
  assert.equal(result.stdout.trim(), '0');
});

test('accepts a normalized UTF-8 layer path', async () => {
  const result = await project(
    rawLayer([
      tarEntry({ name: 'etc/café.conf', bytes: Buffer.from('ollama') }),
    ])
  );
  assert.equal(result.stdout.trim(), '1');
});

test('keeps distinct normalized UTF-8 byte sequences as separate paths', async () => {
  const result = await project(
    rawLayer([
      tarEntry({ name: 'etc/café.conf', bytes: Buffer.from('ollama') }),
      tarEntry({ name: 'etc/cafe\u0301.conf', bytes: Buffer.from('clean') }),
    ])
  );
  assert.equal(result.stdout.trim(), '1');
});

test('keeps distinct safe non-UTF-8 filename bytes as separate paths', async () => {
  const result = await project(
    rawLayer([
      tarEntry({
        name: Buffer.from('etc/raw\x80', 'latin1'),
        bytes: Buffer.from('ollama'),
      }),
      tarEntry({
        name: Buffer.from('etc/raw\xff', 'latin1'),
        bytes: Buffer.from('clean'),
      }),
    ])
  );
  assert.equal(result.stdout.trim(), '1');
});

test('bounds UTF-8 tar paths by encoded byte length', async () => {
  const tooLong = Buffer.from('é'.repeat(2049));
  await assert.rejects(
    project(
      rawLayer([
        tarEntry({ name: 'pax', type: 'x', bytes: paxRecord('path', tooLong) }),
        tarEntry({ name: 'name', bytes: Buffer.from('ollama') }),
      ])
    )
  );
});
