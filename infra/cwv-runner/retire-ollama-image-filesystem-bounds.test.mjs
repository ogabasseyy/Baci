import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const helper = new URL('./retire-ollama-image-filesystem.pl', import.meta.url);
function octal(value, width, suffix = '\0') {
  return `${value.toString(8).padStart(width - suffix.length, '0')}${suffix}`;
}
function tarEntry({
  name,
  prefix = '',
  type = '0',
  bytes = Buffer.alloc(0),
  link = '',
}) {
  const header = Buffer.alloc(512);
  Buffer.from(name).copy(header, 0, 0, 100);
  Buffer.from(prefix).copy(header, 345, 0, 155);
  header.write(octal(0o644, 8), 100);
  header.write(octal(0, 8), 108);
  header.write(octal(0, 8), 116);
  header.write(octal(bytes.length, 12), 124);
  header.fill(0x20, 148, 156);
  header[156] = type.charCodeAt(0);
  header.write(link, 157, 100, 'ascii');
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
const rawLayer = (entries) => Buffer.concat([...entries, Buffer.alloc(1024)]);
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
function imageArchive(layer, manifestJson = undefined) {
  return rawLayer([
    tarEntry({ name: 'layer-0.tar', bytes: layer }),
    tarEntry({
      name: 'manifest.json',
      bytes: Buffer.from(
        manifestJson ??
          JSON.stringify([{ Config: 'config.json', Layers: ['layer-0.tar'] }])
      ),
    }),
  ]);
}
function imageArchiveLayers(layers) {
  return rawLayer([
    ...layers.map((layer, index) =>
      tarEntry({ name: `layer-${index}.tar`, bytes: layer })
    ),
    tarEntry({
      name: 'manifest.json',
      bytes: Buffer.from(
        JSON.stringify([
          {
            Config: 'config.json',
            Layers: layers.map((_layer, index) => `layer-${index}.tar`),
          },
        ])
      ),
    }),
  ]);
}
const duplicateOuterArchive = (layer) => {
  return rawLayer([
    tarEntry({ name: 'layer-0.tar', bytes: layer }),
    tarEntry({ name: 'layer-0.tar', bytes: layer }),
    tarEntry({
      name: 'manifest.json',
      bytes: Buffer.from(
        JSON.stringify([{ Config: 'config.json', Layers: ['layer-0.tar'] }])
      ),
    }),
  ]);
};
async function project(
  layer,
  diagnostic = false,
  maxHeaders = undefined,
  countDiagnostic = false,
  archiveBytes = undefined
) {
  const directory = await mkdtemp(join(tmpdir(), 'baci-image-bounds-'));
  const archive = join(directory, 'image.tar');
  try {
    await writeFile(archive, archiveBytes ?? imageArchive(layer), {
      mode: 0o600,
    });
    const args = [helper.pathname, archive];
    if (countDiagnostic) args.push(directory, '--diagnostic-counts');
    else if (diagnostic) args.push(directory, '--diagnostic');
    return await execFileAsync('/usr/bin/perl', args, {
      env:
        maxHeaders === undefined
          ? process.env
          : {
              ...process.env,
              RETIRE_OLLAMA_IMAGE_MAX_HEADERS: String(maxHeaders),
            },
    });
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
}
test('rejects a tar header storm including extension records', async () => {
  const headers = Array.from({ length: 4097 }, (_, index) =>
    tarEntry({ name: `x-${index}`, type: 'x' })
  );
  await assert.rejects(project(rawLayer(headers), true, 4096));
});
test('accepts production layers with more than the historical header cap', async () => {
  const headers = Array.from({ length: 5000 }, (_, index) =>
    tarEntry({ name: `x-${index}`, type: 'x' })
  );
  assert.equal((await project(rawLayer(headers))).stdout.trim(), '0');
});
test('diagnoses a layer header limit before parsing its next entry', async () => {
  const headers = Array.from({ length: 4097 }, (_, index) =>
    tarEntry({ name: `x-${index}`, type: 'x' })
  );
  await assert.rejects(project(rawLayer(headers), true, 4096), (error) =>
    /phase=layer-header-limit/.test(error.stderr)
  );
});
test('bounds the diagnostic header override by the state limit', async () => {
  await assert.rejects(
    project(rawLayer([tarEntry({ name: 'marker' })]), true, 262145),
    (error) => /phase=input/.test(error.stderr)
  );
});
test('rejects a manifest entry that is not an object', async () => {
  const layer = rawLayer([tarEntry({ name: 'marker' })]);
  await assert.rejects(
    project(layer, false, undefined, false, imageArchive(layer, '[null]'))
  );
});
test('closes stdout before every verdict exit', async () => {
  const source = await readFile(helper, 'utf8');
  assert.match(source, /sub verdict .*close STDOUT or fail/s);
  assert.equal((source.match(/verdict\(/g) ?? []).length, 3);
});
test('rejects unbounded PAX metadata maps', async () => {
  const records = Array.from({ length: 257 }, (_, index) =>
    paxRecord(`k${index}`, 'v')
  );
  await assert.rejects(
    project(
      rawLayer([
        tarEntry({
          name: 'pax',
          type: 'x',
          bytes: Buffer.concat(records),
        }),
        tarEntry({ name: 'marker', bytes: Buffer.from('ollama') }),
      ])
    )
  );
});
test('rejects oversized GNU extension paths', async () => {
  await assert.rejects(
    project(
      rawLayer([
        tarEntry({
          name: 'long',
          type: 'L',
          bytes: Buffer.from(`${'a'.repeat(4097)}\0`),
        }),
        tarEntry({ name: 'marker', bytes: Buffer.from('ollama') }),
      ])
    )
  );
});
test('rejects repeated separators that could alias a whiteout target', async () => {
  await assert.rejects(
    project(
      rawLayer([
        tarEntry({ name: 'etc/current', bytes: Buffer.from('ollama') }),
        tarEntry({ name: 'etc//.wh.current' }),
      ])
    )
  );
});
test('merges duplicate directory headers like Docker tar extraction', async () => {
  const result = await project(
    rawLayer([
      tarEntry({ name: 'etc', type: '5' }),
      tarEntry({ name: './etc/', type: '5' }),
    ])
  );
  assert.equal(result.stdout.trim(), '0');
});
test('uses the later regular payload for duplicate files', async () => {
  const result = await project(
    rawLayer([
      tarEntry({ name: 'etc/service.conf', bytes: Buffer.from('clean') }),
      tarEntry({ name: './etc/service.conf', bytes: Buffer.from('ollama') }),
    ])
  );
  assert.equal(result.stdout.trim(), '1');
});
test('removes implicit descendants when a parent becomes a regular file', async () => {
  const result = await project(
    rawLayer([
      tarEntry({ name: 'dir/implicit.conf', bytes: Buffer.from('ollama') }),
      tarEntry({ name: 'dir', bytes: Buffer.from('clean') }),
    ])
  );
  assert.equal(result.stdout.trim(), '0');
});
test('keeps flat high-entry projection scans bounded without wall-clock assertions', async () => {
  const entries = Array.from({ length: 8000 }, (_, index) =>
    tarEntry({ name: `etc/file-${index}`, bytes: Buffer.from('clean') })
  );
  const result = await project(rawLayer(entries), true, undefined, true);
  assert.match(result.stderr, /headers=2,8000 .*total=8002 .*scans=0/);
});
test('removes repeated directory whiteouts with bounded indexed work', async () => {
  const descendants = 1200;
  const repeatedWhiteouts = 2400;
  const lower = rawLayer(
    Array.from({ length: descendants }, (_, index) =>
      tarEntry({ name: `target/file-${index}`, bytes: Buffer.from('clean') })
    )
  );
  const upper = rawLayer(
    Array.from({ length: repeatedWhiteouts }, () =>
      tarEntry({ name: '.wh.target' })
    )
  );
  const result = await project(
    upper,
    false,
    undefined,
    true,
    imageArchiveLayers([lower, upper])
  );
  assert.equal(result.stdout.trim(), '0');
  assert.match(result.stderr, /headers=3,1200,2400 .*total=3603 .*scans=1200/);
});
test('rejects a non-directory root member', async () => {
  await assert.rejects(
    project(rawLayer([tarEntry({ name: '.', bytes: Buffer.from('ollama') })]))
  );
});
test('rejects duplicate canonical members in the outer archive', async () => {
  await assert.rejects(
    project(
      rawLayer([
        tarEntry({ name: 'etc/live.conf', bytes: Buffer.from('ollama') }),
      ]),
      false,
      undefined,
      false,
      duplicateOuterArchive(
        rawLayer([
          tarEntry({ name: 'etc/live.conf', bytes: Buffer.from('ollama') }),
        ])
      )
    )
  );
});
test('rejects hardlinks whose target is not a regular file', async () => {
  await assert.rejects(
    project(
      rawLayer([
        tarEntry({ name: 'etc/target', type: '2', link: 'etc/other' }),
        tarEntry({ name: 'etc/hard', type: '1', link: 'etc/target' }),
      ])
    )
  );
});
