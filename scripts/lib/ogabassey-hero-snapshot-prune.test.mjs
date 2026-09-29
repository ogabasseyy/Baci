import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SNAPSHOT_QUALITY } from './ogabassey-hero-snapshot-config.mjs';
import { pruneSnapshotOrphans } from './ogabassey-hero-snapshot-prune.mjs';

function makeEntry(overrides = {}) {
  return {
    sourceUrl: 'https://cdn.ogabassey.com/core-assets/products/dell.jpg',
    srcSet: '/_hero/ogabassey/aaa-640.avif 640w',
    href: '/_hero/ogabassey/aaa-640.avif',
    quality: SNAPSHOT_QUALITY,
    widths: [640],
    sourceSha256: 'b'.repeat(64),
    ...overrides,
  };
}

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

describe('pruneSnapshotOrphans', () => {
  it('prunes only unreferenced pipeline-managed files', () => {
    const outDir = resolve(mkdtempSync(join(tmpdir(), 'hero-prune-')), 'ogabassey');
    mkdirSync(outDir, { recursive: true });
    const kept = 'aaaaaaaaaaaa-640.avif';
    const orphan = 'bbbbbbbbbbbb-640.avif';
    const foreign = 'hand-placed.png';
    for (const file of [kept, orphan, foreign]) {
      writeFileSync(resolve(outDir, file), 'x');
    }
    const pruned = pruneSnapshotOrphans(outDir, [
      makeEntry({
        srcSet: `/_hero/ogabassey/${kept} 640w`,
        href: `/_hero/ogabassey/${kept}`,
      }),
    ]);

    expect(pruned).toEqual([orphan]);
    expect(existsSync(resolve(outDir, kept))).toBe(true);
    expect(existsSync(resolve(outDir, orphan))).toBe(false);
    expect(existsSync(resolve(outDir, foreign))).toBe(true);
  });
});
