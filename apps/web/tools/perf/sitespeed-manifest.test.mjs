import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { loadResumableManifest } from './sitespeed-manifest.mjs';

it('replaces an empty manifest identity but preserves identity when runs exist', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sitespeed-manifest-'));
  try {
    const file = join(root, 'run-manifest.json');
    const current = { buildId: 'new', baseUrl: 'http://new', runs: {} };
    const previous = { buildId: 'old', baseUrl: 'http://old', runs: {} };
    await writeFile(file, JSON.stringify(previous));
    expect(loadResumableManifest(file, current)).toEqual(current);
    previous.runs.home = { status: 'complete' };
    await writeFile(file, JSON.stringify(previous));
    expect(loadResumableManifest(file, current)).toEqual(previous);
    expect(loadResumableManifest(file, current, true)).toEqual(current);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
