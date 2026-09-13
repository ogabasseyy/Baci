import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import {
  chmod,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { gzipSync } from 'node:zlib';
import { createSourceArchive } from './source-archive.mjs';

const execFileAsync = promisify(execFile);
const helper = new URL('./retire-ollama-image-filesystem.pl', import.meta.url);

function imageArchive() {
  const layer = gzipSync(
    createSourceArchive([
      { bytes: Buffer.from('clean'), mode: '100644', path: 'etc/clean.conf' },
    ])
  );
  return createSourceArchive([
    { bytes: layer, mode: '100644', path: 'layer-0.tar' },
    {
      bytes: Buffer.from(
        JSON.stringify([{ Config: 'config.json', Layers: ['layer-0.tar'] }])
      ),
      mode: '100644',
      path: 'manifest.json',
    },
  ]);
}

function sevenDigitChecksums(archive) {
  const output = Buffer.from(archive);
  let offset = 0;
  while (
    offset + 512 <= output.length &&
    output.subarray(offset, offset + 512).some(Boolean)
  ) {
    const header = output.subarray(offset, offset + 512);
    const size = Number.parseInt(
      header.subarray(124, 136).toString('ascii').trim(),
      8
    );
    header.fill(0x20, 148, 156);
    const checksum = header.reduce((total, byte) => total + byte, 0);
    Buffer.from(`${checksum.toString(8).padStart(7, '0')}\0`, 'ascii').copy(
      header,
      148
    );
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return output;
}

function run(archive, root) {
  return execFileAsync('/usr/bin/perl', [helper.pathname, archive, root]);
}

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'baci-image-open-'));
  const archive = join(directory, 'image.tar');
  await writeFile(archive, imageArchive(), { mode: 0o600 });
  return { directory, archive };
}

test('rejects an archive path that resolves through a symlink', async () => {
  const value = await fixture();
  const alias = join(value.directory, 'alias.tar');
  await symlink(value.archive, alias);
  try {
    await assert.rejects(run(alias, value.directory));
  } finally {
    await rm(value.directory, { force: true, recursive: true });
  }
});

test('rejects an archive whose mode is writable by another principal', async () => {
  const value = await fixture();
  try {
    await chmod(value.archive, 0o644);
    await assert.rejects(run(value.archive, value.directory));
  } finally {
    await rm(value.directory, { force: true, recursive: true });
  }
});

test('rejects a scratch root supplied through a symlink', async () => {
  const value = await fixture();
  const alias = join(value.directory, 'scratch-alias');
  await symlink(value.directory, alias);
  try {
    await assert.rejects(run(value.archive, alias));
  } finally {
    await rm(value.directory, { force: true, recursive: true });
  }
});

test('rejects a scratch root whose mode is not private', async () => {
  const value = await fixture();
  try {
    await chmod(value.directory, 0o755);
    await assert.rejects(run(value.archive, value.directory));
  } finally {
    await rm(value.directory, { force: true, recursive: true });
  }
});

test('accepts a canonical private archive and scratch root', async () => {
  const value = await fixture();
  try {
    const { stdout } = await run(value.archive, value.directory);
    assert.equal(stdout.trim(), '0');
  } finally {
    await rm(value.directory, { force: true, recursive: true });
  }
});

test('accepts seven-digit checksum fields terminated by NUL', async () => {
  const value = await fixture();
  try {
    await writeFile(
      value.archive,
      sevenDigitChecksums(await readFile(value.archive)),
      { mode: 0o600 }
    );
    const { stdout } = await run(value.archive, value.directory);
    assert.equal(stdout.trim(), '0');
  } finally {
    await rm(value.directory, { force: true, recursive: true });
  }
});
