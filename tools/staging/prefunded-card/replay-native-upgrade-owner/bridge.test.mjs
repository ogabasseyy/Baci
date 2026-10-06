import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { verifyRootArtifact } from './bridge.mjs';

const fixtureArguments = process.argv.slice(2);
const directory =
  fixtureArguments.length === 2 && fixtureArguments[0] === '--artifact'
    ? fixtureArguments[1]
    : undefined;
if (typeof directory !== 'string' || !path.isAbsolute(directory))
  throw new Error(
    '--artifact must select the reviewed artifact; essential tests are not skipped'
  );
const fixture = async () => ({
  manifestBytes: await readFile(`${directory}/manifest.json`),
  reviewedManifestSha256:
    'b0ac46778810cf5769dbd6c56c52df30ca845dc6a90e4245f1949b5826fc5e11',
  bundleBytes: await readFile(`${directory}/prefunded-replay-bundle.mjs`),
  inventoryBytes: await readFile(`${directory}/inventory.json`),
  metafileBytes: await readFile(`${directory}/metafile.json`),
  virtualEntryBytes: await readFile(`${directory}/virtual-entry.ts`),
  captures: new Map(
    await Promise.all(
      (await readdir(`${directory}/captures`)).map(async (name) => [
        name.slice(0, 64),
        await readFile(`${directory}/captures/${name}`),
      ])
    )
  ),
});

test('bugfix: verifies the actual generated manifest with raw productionDelta inventory, not invented files', async () => {
  const input = await fixture();
  const manifest = JSON.parse(input.manifestBytes);
  assert.equal(manifest.inventory.files, undefined);
  assert.equal(manifest.inventory.productionDelta.length, 6);
  const verified = await verifyRootArtifact(input);
  assert.equal(
    verified.bundleSha256,
    'b73f5ed97441b8e1941badc340eefee787c43d300bdf033c46174e4e79bab9c4'
  );
  assert.equal(Object.keys(verified.manifest.sources).length, 151);
});

test('refuses arbitrary manifest pin, changed captured bytes and omitted ingest inventory', async () => {
  for (const change of ['pin', 'capture', 'ingest']) {
    const value = await fixture();
    if (change === 'pin') value.reviewedManifestSha256 = 'f'.repeat(64);
    if (change === 'capture')
      value.captures.set(
        value.captures.keys().next().value,
        Buffer.from('changed')
      );
    if (change === 'ingest') {
      const inventory = JSON.parse(value.inventoryBytes);
      inventory.productionDelta.splice(1, 1);
      value.inventoryBytes = Buffer.from(JSON.stringify(inventory));
    }
    await assert.rejects(verifyRootArtifact(value), /refused/);
  }
});
