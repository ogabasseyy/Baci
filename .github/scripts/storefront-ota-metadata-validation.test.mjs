import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { validateExportMetadata } from './storefront-ota-metadata-validation.mjs';

test('rejects an export whose bundle was built from a different revision', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'ota-metadata-'));
  try {
    await writeFile(path.join(directory, 'bundle.hbc'), 'wrong-revision');
    await writeFile(
      path.join(directory, 'metadata.json'),
      JSON.stringify({ fileMetadata: { ios: { bundle: 'bundle.hbc', assets: [] } } })
    );
    await assert.rejects(
      validateExportMetadata(directory, '11d3af0992600ba26e7d9a69f533ffc6737737b4'),
      /revision/i
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('accepts an iOS export with its stated revision and available assets', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'ota-metadata-'));
  const sha = '11d3af0992600ba26e7d9a69f533ffc6737737b4';
  try {
    await writeFile(path.join(directory, 'bundle.hbc'), `bundle-${sha}`);
    await writeFile(path.join(directory, 'bundle.hbc.map'), '{}');
    await writeFile(path.join(directory, 'asset.png'), 'asset');
    await writeFile(
      path.join(directory, 'metadata.json'),
      JSON.stringify({
        fileMetadata: { ios: { bundle: 'bundle.hbc', assets: [{ path: 'asset.png' }] } },
      })
    );
    await assert.doesNotReject(validateExportMetadata(directory, sha));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('rejects an export that omitted the bundle source map', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'ota-metadata-'));
  const sha = '11d3af0992600ba26e7d9a69f533ffc6737737b4';
  try {
    await writeFile(path.join(directory, 'bundle.hbc'), `bundle-${sha}`);
    await writeFile(path.join(directory, 'metadata.json'), JSON.stringify({
      fileMetadata: { ios: { bundle: 'bundle.hbc', assets: [] } },
    }));
    await assert.rejects(validateExportMetadata(directory, sha), /source map/i);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
