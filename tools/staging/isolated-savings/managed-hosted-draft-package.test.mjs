import assert from 'node:assert/strict';
import { copyFile, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

const directory = new URL('.', import.meta.url);
const closure = [
  'managed-hosted-draft-owner-activation.mjs',
  'managed-hosted-draft-activation-runner.mjs',
  'managed-nginx-owner-actions.mjs',
  'managed-nginx-worker-selection.mjs',
  'install-managed-nginx-activation.mjs',
  'managed-nginx-activation.mjs',
  'managed-gateway.mjs',
  'private-routing.mjs',
  'private-routing-inventory.mjs',
  'compose.mjs',
  'managed-private-smoke.mjs',
  'managed-private-smoke-runner.mjs',
  'managed-route-contract.mjs',
  'managed-lease-window.mjs',
  'managed-funding-route-contract.mjs',
  'managed-hosted-draft-identity.json',
  'managed-install-manifest.json',
];

test('sealed hosted package contains every static local import', async () => {
  const manifest = await readFile(
    new URL('./managed-hosted-draft-activation.SHA256SUMS', import.meta.url),
    'utf8'
  );
  assert.deepEqual(
    manifest
      .trim()
      .split('\n')
      .map((line) => line.slice(66))
      .sort(),
    [...closure].sort()
  );
  const temporary = await mkdtemp(resolve(tmpdir(), 'baci-hosted-draft-'));
  try {
    for (const name of closure)
      await copyFile(new URL(name, directory), resolve(temporary, name));
    await import(
      pathToFileURL(
        resolve(temporary, 'managed-hosted-draft-owner-activation.mjs')
      ).href
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
