import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { createSourceArchive } from './source-archive.mjs';

const execFileAsync = promisify(execFile);
const helper = new URL('./retire-ollama-image-filesystem.pl', import.meta.url);
const octal = (value, width, suffix = '\0') =>
  `${value.toString(8).padStart(width - suffix.length, '0')}${suffix}`;

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

function imageArchive(layer) {
  const layerArchive = Buffer.concat([...layer, Buffer.alloc(1024)]);
  return createSourceArchive([
    { bytes: layerArchive, mode: '100644', path: 'layer-0.tar' },
    {
      bytes: Buffer.from(
        JSON.stringify([{ Config: 'config.json', Layers: ['layer-0.tar'] }])
      ),
      mode: '100644',
      path: 'manifest.json',
    },
  ]);
}

function largeImageArchive(layer) {
  const layerArchive = Buffer.concat([...layer, Buffer.alloc(1024)]);
  const manifest = Buffer.from(
    JSON.stringify([{ Config: 'config.json', Layers: ['layer-0.tar'] }])
  );
  return Buffer.concat([
    tarEntry({ name: 'layer-0.tar', bytes: layerArchive }),
    tarEntry({ name: 'manifest.json', bytes: manifest }),
    Buffer.alloc(1024),
  ]);
}

test('resolves a forward hardlink after the regular target appears later in the layer', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'baci-image-hardlink-'));
  const archive = join(directory, 'image.tar');
  try {
    const layer = [
      tarEntry({ name: 'etc/tool', type: '1', link: 'etc/target' }),
      tarEntry({ name: 'etc/target', bytes: Buffer.from('clean') }),
    ];
    await writeFile(archive, imageArchive(layer), { mode: 0o600 });
    const { stdout } = await execFileAsync('/usr/bin/perl', [
      helper.pathname,
      archive,
      directory,
    ]);
    assert.equal(stdout.trim(), '0');
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test('retains a backward hardlink marker when its target is replaced later', async () => {
  const directory = await mkdtemp(
    join(tmpdir(), 'baci-image-hardlink-replace-')
  );
  const archive = join(directory, 'image.tar');
  try {
    const layer = [
      tarEntry({ name: 'etc/target', bytes: Buffer.from('ollama') }),
      tarEntry({ name: 'etc/tool', type: '1', link: 'etc/target' }),
      tarEntry({ name: 'etc/target', bytes: Buffer.from('clean') }),
    ];
    await writeFile(archive, imageArchive(layer), { mode: 0o600 });
    const { stdout } = await execFileAsync('/usr/bin/perl', [
      helper.pathname,
      archive,
      directory,
    ]);
    assert.equal(stdout.trim(), '1');
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test('retains a forward hardlink marker when its target is replaced later', async () => {
  const directory = await mkdtemp(
    join(tmpdir(), 'baci-image-forward-hardlink-replace-')
  );
  const archive = join(directory, 'image.tar');
  try {
    const layer = [
      tarEntry({ name: 'etc/tool', type: '1', link: 'etc/target' }),
      tarEntry({ name: 'etc/target', bytes: Buffer.from('ollama') }),
      tarEntry({ name: 'etc/target', bytes: Buffer.from('clean') }),
    ];
    await writeFile(archive, imageArchive(layer), { mode: 0o600 });
    const { stdout } = await execFileAsync('/usr/bin/perl', [
      helper.pathname,
      archive,
      directory,
    ]);
    assert.equal(stdout.trim(), '1');
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test('resolves a long forward-hardlink chain without recursive stack growth', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'baci-image-hardlink-chain-'));
  const archive = join(directory, 'image.tar');
  try {
    const count = 10_000;
    const layer = Array.from({ length: count }, (_, index) =>
      tarEntry({
        name: `chain/${index}`,
        type: '1',
        link: index + 1 === count ? 'chain/target' : `chain/${index + 1}`,
      })
    );
    layer.push(
      tarEntry({ name: 'chain/target', bytes: Buffer.from('ollama') })
    );
    await writeFile(archive, largeImageArchive(layer), { mode: 0o600 });
    const { stdout } = await execFileAsync('/usr/bin/perl', [
      helper.pathname,
      archive,
      directory,
    ]);
    assert.equal(stdout.trim(), '1');
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});
