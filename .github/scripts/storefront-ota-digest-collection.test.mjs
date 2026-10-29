import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { collectExportDigests } from './storefront-ota-digest-collection.mjs';
import { sha256 } from './storefront-ota-sha256.mjs';

test('hashes nested export files and excludes only root provenance', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'ota-digests-'));
  try {
    await mkdir(path.join(directory, 'dist'));
    await writeFile(path.join(directory, 'dist', 'bundle'), 'bundle');
    await writeFile(path.join(directory, 'dist', 'provenance.json'), 'nested');
    await writeFile(path.join(directory, 'provenance.json'), 'root');
    assert.deepEqual(await collectExportDigests(directory), {
      'dist/bundle': sha256('bundle'),
      'dist/provenance.json': sha256('nested'),
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('rejects symbolic links instead of following files outside the export', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'ota-digests-'));
  try {
    await symlink(os.tmpdir(), path.join(directory, 'link'));
    await assert.rejects(collectExportDigests(directory), /symbolic link/i);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
