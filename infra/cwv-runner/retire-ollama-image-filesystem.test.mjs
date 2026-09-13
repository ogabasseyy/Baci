import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { gzipSync } from 'node:zlib';
import { createSourceArchive } from './source-archive.mjs';

const execFileAsync = promisify(execFile);
const helper = new URL('./retire-ollama-image-filesystem.pl', import.meta.url);

function imageArchive(layers) {
  const layerMembers = layers.map((entries) =>
    entries instanceof Buffer
      ? entries
      : createSourceArchive(
          entries.map(({ path, content = '' }) => ({
            bytes: Buffer.from(content),
            mode: '100644',
            path,
          }))
        )
  );
  return createSourceArchive([
    ...layerMembers.map((bytes, index) => ({
      bytes,
      mode: '100644',
      path: `layer-${index}.tar`,
    })),
    {
      bytes: Buffer.from(
        JSON.stringify([
          {
            Config: 'config.json',
            Layers: layers.map((_layer, index) => `layer-${index}.tar`),
          },
        ])
      ),
      mode: '100644',
      path: 'manifest.json',
    },
  ]);
}

function octal(value, width, suffix = '\0') {
  return `${value.toString(8).padStart(width - suffix.length, '0')}${suffix}`;
}

function tarEntry({ name, type = '0', bytes = Buffer.alloc(0), link = '' }) {
  const header = Buffer.alloc(512);
  header.write(name, 0, 100, 'ascii');
  header.write(octal(0o644, 8), 100);
  header.write(octal(0, 8), 108);
  header.write(octal(0, 8), 116);
  header.write(octal(bytes.length, 12), 124);
  header.write(octal(0, 12), 136);
  header.fill(0x20, 148, 156);
  header[156] = type.charCodeAt(0);
  header.write(link, 157, 100, 'ascii');
  header.write('ustar\0', 257, 'ascii');
  header.write('00', 263, 'ascii');
  const checksum = header.reduce((total, byte) => total + byte, 0);
  header.write(octal(checksum, 8, '\0 '), 148);
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
  const body = `${key}=${value}\n`;
  let length = body.length + 2;
  while (true) {
    const next = String(length).length + 1 + body.length;
    if (next === length) return Buffer.from(`${length} ${body}`);
    length = next;
  }
}

async function project(layers) {
  const directory = await mkdtemp(join(tmpdir(), 'baci-image-projector-'));
  const archive = join(directory, 'image.tar');
  try {
    await writeFile(archive, imageArchive(layers), { mode: 0o600 });
    const { stdout } = await execFileAsync('/usr/bin/perl', [
      helper.pathname,
      archive,
      directory,
    ]);
    return stdout.trim();
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
}

async function projectWithoutScratch(layers) {
  const directory = await mkdtemp(
    join(tmpdir(), 'baci-image-projector-fallback-')
  );
  const archive = join(directory, 'image.tar');
  try {
    await writeFile(archive, imageArchive(layers), { mode: 0o600 });
    return await execFileAsync('/usr/bin/perl', [helper.pathname, archive]);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
}

test('does not report a marker that a later whiteout deletes from the merged image', async () => {
  assert.equal(
    await project([
      [
        {
          content: 'ollama was present in an old layer',
          path: 'etc/service.conf',
        },
      ],
      [{ path: 'etc/.wh.service.conf' }],
    ]),
    '0'
  );
});
test('rejects the shared fallback scratch root without an explicit private root', async () => {
  await assert.rejects(
    projectWithoutScratch([
      gzipSync(
        createSourceArchive([
          {
            bytes: Buffer.from('current endpoint http://127.0.0.1:11434'),
            mode: '100644',
            path: 'etc/current.conf',
          },
        ])
      ),
    ])
  );
});
test('does not report a marker replaced by a clean file in a later layer', async () => {
  assert.equal(
    await project([
      [
        {
          content: 'ollama was present in an old layer',
          path: 'etc/service.conf',
        },
      ],
      [{ content: 'ordinary service configuration', path: 'etc/service.conf' }],
    ]),
    '0'
  );
});
test('reports a marker present in the final merged layer', async () => {
  assert.equal(
    await project([
      [{ content: 'ordinary service configuration', path: 'etc/service.conf' }],
      [
        {
          content: 'current endpoint http://127.0.0.1:11434',
          path: 'etc/current.conf',
        },
      ],
    ]),
    '1'
  );
});
test('accepts a safe relative symlink target with parent traversal', async () => {
  assert.equal(
    await project([
      rawLayer([
        tarEntry({ name: 'usr/lib/current', bytes: Buffer.from('clean') }),
        tarEntry({
          name: 'usr/bin/tool',
          type: '2',
          link: '../lib/current',
        }),
      ]),
    ]),
    '0'
  );
});
test('accepts a symlink target whose value is the string zero', async () => {
  assert.equal(
    await project([
      rawLayer([tarEntry({ name: 'etc/tool', type: '2', link: '0' })]),
    ]),
    '0'
  );
});
test('accepts a hardlink target whose value is the string zero', async () => {
  assert.equal(
    await project([
      rawLayer([
        tarEntry({ name: '0', bytes: Buffer.from('clean') }),
        tarEntry({ name: 'etc/tool', type: '1', link: '0' }),
      ]),
    ]),
    '0'
  );
});
test('rejects a symlink target that escapes the image root', async () => {
  await assert.rejects(
    project([
      rawLayer([
        tarEntry({
          name: 'usr/bin/tool',
          type: '2',
          link: '../../../escape',
        }),
      ]),
    ])
  );
});
test('preserves a hardlink inode snapshot after its target is replaced', async () => {
  assert.equal(
    await project([
      rawLayer([
        tarEntry({ name: 'usr/lib/ollama', bytes: Buffer.from('ollama') }),
      ]),
      rawLayer([
        tarEntry({
          name: 'usr/bin/tool',
          type: '1',
          link: 'usr/lib/ollama',
        }),
      ]),
      rawLayer([tarEntry({ name: 'usr/lib/.wh.ollama' })]),
    ]),
    '1'
  );
});

test('reports a marker-named hardlink to a clean regular target', async () => {
  assert.equal(
    await project([
      rawLayer([
        tarEntry({ name: 'usr/lib/current', bytes: Buffer.from('clean') }),
      ]),
      rawLayer([
        tarEntry({
          name: 'usr/bin/ollama-tool',
          type: '1',
          link: 'usr/lib/current',
        }),
      ]),
    ]),
    '1'
  );
});

test('accepts PAX path and linkpath metadata', async () => {
  assert.equal(
    await project([
      rawLayer([
        tarEntry({
          name: 'PaxHeaders/path',
          type: 'x',
          bytes: paxRecord('path', 'usr/lib/ollama'),
        }),
        tarEntry({ name: 'placeholder', bytes: Buffer.from('ollama') }),
        tarEntry({
          name: 'PaxHeaders/link',
          type: 'x',
          bytes: paxRecord('linkpath', '../lib/ollama'),
        }),
        tarEntry({ name: 'usr/bin/tool', type: '2' }),
      ]),
    ]),
    '1'
  );
});

test('accepts GNU longname and longlink metadata', async () => {
  assert.equal(
    await project([
      rawLayer([
        tarEntry({
          name: '././@LongLink',
          type: 'L',
          bytes: Buffer.from('usr/lib/ollama\0'),
        }),
        tarEntry({ name: 'placeholder', bytes: Buffer.from('ollama') }),
        tarEntry({ name: 'usr/lib/current', bytes: Buffer.from('clean') }),
        tarEntry({
          name: '././@LongLink',
          type: 'K',
          bytes: Buffer.from('../lib/current\0'),
        }),
        tarEntry({ name: 'usr/bin/tool', type: '2' }),
      ]),
    ]),
    '1'
  );
});
