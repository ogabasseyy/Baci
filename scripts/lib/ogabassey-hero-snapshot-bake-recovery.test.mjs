import { createHash } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { bakeSnapshots } from './ogabassey-hero-snapshot-bake.mjs';
import {
  FAKE_BAKE_SOURCE_URL,
  makeFakeBakeFetch,
  makeFakeSharp,
} from './ogabassey-hero-snapshot-bake.test-fixture.mjs';

const SOURCE_URL = FAKE_BAKE_SOURCE_URL;

function makeFailingFetch() {
  return vi.fn(async (url) => ({
    ok: !String(url).includes('bad.jpg'),
    status: String(url).includes('bad.jpg') ? 500 : 200,
    url: String(url),
    headers: { get: () => 'image/jpeg' },
    arrayBuffer: async () => Buffer.from('fake-source-bytes'),
  }));
}

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

describe('bakeSnapshots recovery', () => {
  it('rolls back earlier urls when a later one fails', async () => {
    const outDir = resolve(mkdtempSync(join(tmpdir(), 'hero-bake-')), 'ogabassey');
    await expect(
      bakeSnapshots({
        fetchImpl: makeFailingFetch(),
        outDir,
        sharpImpl: makeFakeSharp(),
        slug: 'ogabassey',
        urls: [SOURCE_URL, 'https://cdn.ogabassey.com/bad.jpg'],
      })
    ).rejects.toThrow(/HTTP 500/);
    expect(readdirSync(outDir)).toEqual([]);
  });

  it('preserves pre-existing files when rolling back', async () => {
    const outDir = resolve(mkdtempSync(join(tmpdir(), 'hero-bake-')), 'ogabassey');
    mkdirSync(outDir, { recursive: true });
    // Regeneration rewrites identical bytes (content hash); the committed
    // file must survive a later-url failure, not join the rollback set.
    const committedName = `${createHash('sha256').update('fake-avif-v1-256').digest('hex').slice(0, 12)}-256.avif`;
    writeFileSync(resolve(outDir, committedName), 'fake-avif-v1-256');
    await expect(
      bakeSnapshots({
        fetchImpl: makeFailingFetch(),
        outDir,
        sharpImpl: makeFakeSharp(),
        slug: 'ogabassey',
        urls: [SOURCE_URL, 'https://cdn.ogabassey.com/bad.jpg'],
      })
    ).rejects.toThrow(/HTTP 500/);

    expect(readdirSync(outDir)).toEqual([committedName]);
    expect(readFileSync(resolve(outDir, committedName), 'utf8')).toBe(
      'fake-avif-v1-256'
    );
  });

  it('leaves no partial or temp files when the asset write fails', async () => {
    const outDir = resolve(mkdtempSync(join(tmpdir(), 'hero-bake-')), 'ogabassey');
    mkdirSync(outDir, { recursive: true });
    // A committed asset the old manifest still references: the failed run
    // must neither truncate it nor leave a partial/temp sibling behind.
    const committedName = 'committed-asset-640.avif';
    writeFileSync(resolve(outDir, committedName), 'committed-bytes');
    // Fail the atomic replacement deterministically (and as any user): a
    // directory at the destination path makes the temp→final rename throw
    // after the temp write succeeded, exercising the same catch block as a
    // mid-write ENOSPC.
    const firstName = `${createHash('sha256').update('fake-avif-v1-256').digest('hex').slice(0, 12)}-256.avif`;
    mkdirSync(resolve(outDir, firstName));
    await expect(
      bakeSnapshots({
        fetchImpl: makeFakeBakeFetch(),
        outDir,
        sharpImpl: makeFakeSharp(),
        slug: 'ogabassey',
        urls: [SOURCE_URL],
      })
    ).rejects.toThrow();
    expect(readdirSync(outDir).sort()).toEqual(
      [committedName, firstName].sort()
    );
    expect(
      readdirSync(outDir).some((name) => name.includes('.tmp-'))
    ).toBe(false);
    expect(readFileSync(resolve(outDir, committedName), 'utf8')).toBe(
      'committed-bytes'
    );
  });

  it('sweeps stale temp siblings from a killed run before baking', async () => {
    const outDir = resolve(mkdtempSync(join(tmpdir(), 'hero-bake-')), 'ogabassey');
    mkdirSync(outDir, { recursive: true });
    writeFileSync(resolve(outDir, 'abc123-640.avif.tmp-99999999'), 'partial');
    await bakeSnapshots({
      fetchImpl: makeFakeBakeFetch(),
      outDir,
      sharpImpl: makeFakeSharp(),
      slug: 'ogabassey',
      urls: [SOURCE_URL],
    });
    expect(
      readdirSync(outDir).some((name) => name.includes('.tmp-'))
    ).toBe(false);
  });
});
