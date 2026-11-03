import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./prepare-storefront-ota-public-config.mjs', import.meta.url));

test('prepares the public config with the verified existing capability', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'ota-config-'));
  const file = path.join(directory, 'config.json');
  try {
    await writeFile(file, JSON.stringify({
      plugins: ['expo-router'],
      extra: { tiktokBusiness: { isConfigured: false, iosAppStoreId: '123' } },
    }));
    execFileSync(process.execPath, [script, file, 'true'], { stdio: 'pipe' });
    const config = JSON.parse(await readFile(file, 'utf8'));
    assert.equal(config.extra.tiktokBusiness.isConfigured, true);
    assert.equal(config.extra.tiktokBusiness.iosAppStoreId, '123');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('rejects invalid input without changing the original config', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'ota-config-'));
  const file = path.join(directory, 'config.json');
  const contents = JSON.stringify({ extra: { tiktokBusiness: { isConfigured: false } } });
  try {
    await writeFile(file, contents);
    assert.throws(() => execFileSync(process.execPath, [script, file, 'unknown'], { stdio: 'pipe' }));
    assert.equal(await readFile(file, 'utf8'), contents);
    assert.throws(() => execFileSync(process.execPath, [script], { stdio: 'pipe' }));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
