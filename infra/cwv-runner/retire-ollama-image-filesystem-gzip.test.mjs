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

function gzipLayer(entries) {
  return gzipSync(
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
}

async function project(layers, maxExpanded) {
  const directory = await mkdtemp(join(tmpdir(), 'baci-image-gzip-'));
  const archive = join(directory, 'image.tar');
  try {
    await writeFile(archive, imageArchive(layers), { mode: 0o600 });
    const { stdout } = await execFileAsync(
      '/usr/bin/perl',
      [helper.pathname, archive, directory],
      {
        env: {
          ...process.env,
          ...(maxExpanded === undefined
            ? {}
            : {
                RETIRE_OLLAMA_IMAGE_MAX_EXPANDED_BYTES: String(maxExpanded),
              }),
        },
      }
    );
    return stdout.trim();
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
}

async function diagnostic(layers) {
  const directory = await mkdtemp(
    join(tmpdir(), 'baci-image-gzip-diagnostic-')
  );
  const archive = join(directory, 'image.tar');
  try {
    await writeFile(archive, imageArchive(layers), { mode: 0o600 });
    const result = await execFileAsync('/usr/bin/perl', [
      helper.pathname,
      archive,
      directory,
      '--diagnostic',
    ]).then(
      () => null,
      (error) => error
    );
    assert.ok(result);
    return result.stderr;
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
}

async function diagnosticCounts(layers) {
  const directory = await mkdtemp(
    join(tmpdir(), 'baci-image-index-diagnostic-')
  );
  const archive = join(directory, 'image.tar');
  try {
    await writeFile(archive, imageArchive(layers), { mode: 0o600 });
    return await execFileAsync('/usr/bin/perl', [
      helper.pathname,
      archive,
      directory,
      '--diagnostic-counts',
    ]);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
}

test('bounds index visits for image layers with many unique parent directories', async () => {
  const entries = Array.from({ length: 1000 }, (_, index) => ({
    path: `directory-${String(index).padStart(4, '0')}/file`,
  }));
  const result = await diagnosticCounts([entries]);
  assert.match(result.stderr, /headers=2,1000 .*index-visits=2000\n$/);
});

test('does not report a gzip historical marker deleted by a later whiteout', async () => {
  assert.equal(
    await project([
      gzipLayer([
        {
          content: 'ollama was present in an old layer',
          path: 'etc/service.conf',
        },
      ]),
      gzipLayer([{ path: 'etc/.wh.service.conf' }]),
    ]),
    '0'
  );
});

test('reports a marker in the final gzip live-format layer', async () => {
  assert.equal(
    await project([
      gzipLayer([
        {
          content: 'current endpoint http://127.0.0.1:11434',
          path: 'etc/current.conf',
        },
      ]),
    ]),
    '1'
  );
});

test('rejects a gzip bomb before the bounded per-layer expanded limit', async () => {
  await assert.rejects(
    project(
      [gzipLayer([{ content: 'x'.repeat(4096), path: 'etc/large.conf' }])],
      1024
    )
  );
});

test('rejects cumulative gzip expansion beyond its separate bound', async () => {
  await assert.rejects(
    project(
      [
        gzipLayer([{ content: 'x'.repeat(700), path: 'etc/one.conf' }]),
        gzipLayer([{ content: 'x'.repeat(700), path: 'etc/two.conf' }]),
      ],
      4096
    )
  );
});

test('rejects a truncated gzip member during read', async () => {
  const layer = gzipLayer([
    {
      content: 'current endpoint http://127.0.0.1:11434',
      path: 'etc/service.conf',
    },
  ]);
  await assert.rejects(project([layer.subarray(0, -1)]));
});

test('rejects trailing and concatenated gzip members', async () => {
  const layer = gzipLayer([{ content: 'ollama', path: 'etc/service.conf' }]);
  await assert.rejects(project([Buffer.concat([layer, Buffer.from('tail')])]));
  await assert.rejects(
    project([Buffer.concat([layer, gzipLayer(Buffer.alloc(0))])])
  );
});

test('rejects malformed gzip data', async () => {
  await assert.rejects(project([Buffer.from([0x1f, 0x8b, 0x08, 0x00, 0x00])]));
});

test('diagnostic mode emits only a fixed phase for malformed gzip data', async () => {
  assert.match(
    await diagnostic([Buffer.from([0x1f, 0x8b, 0x08, 0x00, 0x00])]),
    /^image projection refused phase=layer-gzip-construct\nimage projection refused\n$/
  );
});
