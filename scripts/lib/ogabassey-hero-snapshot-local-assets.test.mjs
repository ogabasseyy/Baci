import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { verifySnapshotLocalAssets } from './ogabassey-hero-snapshot-local-assets.mjs';

const URL = 'https://cdn.ogabassey.com/core-assets/products/dell.jpg';

function seedAsset(outDir, width, bytes) {
  const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 12);
  const fileName = `${hash}-${width}.avif`;
  writeFileSync(resolve(outDir, fileName), bytes);
  return `/_hero/ogabassey/${fileName}`;
}

function setup() {
  const outDir = resolve(mkdtempSync(join(tmpdir(), 'hero-assets-')), 'ogabassey');
  mkdirSync(outDir, { recursive: true });
  return outDir;
}

describe('verifySnapshotLocalAssets', () => {
  it('passes when every referenced file matches its content hash', () => {
    const outDir = setup();
    const href = seedAsset(outDir, 640, Buffer.from('bytes-640'));
    const wide = seedAsset(outDir, 1200, Buffer.from('bytes-1200'));
    const { verifiedFiles } = verifySnapshotLocalAssets({
      entries: {
        [URL]: { href, srcSet: `${href} 640w, ${wide} 1200w` },
      },
      outDir,
      urls: [URL],
    });
    expect(verifiedFiles).toHaveLength(2);
  });

  it('fails on a missing file', () => {
    const outDir = setup();
    expect(() =>
      verifySnapshotLocalAssets({
        entries: {
          [URL]: {
            href: '/_hero/ogabassey/deadbeefcafe-640.avif',
            srcSet: '/_hero/ogabassey/deadbeefcafe-640.avif 640w',
          },
        },
        outDir,
        urls: [URL],
      })
    ).toThrow(/missing/);
  });

  it('fails on bytes that no longer match the filename hash', () => {
    const outDir = setup();
    const href = seedAsset(outDir, 640, Buffer.from('original-bytes'));
    writeFileSync(
      resolve(outDir, href.split('/').pop()),
      Buffer.from('replaced-bytes')
    );
    expect(() =>
      verifySnapshotLocalAssets({
        entries: { [URL]: { href, srcSet: `${href} 640w` } },
        outDir,
        urls: [URL],
      })
    ).toThrow(/do not match the content hash/);
  });

  it('fails on a srcSet descriptor that disagrees with the filename width', () => {
    const outDir = setup();
    const href = seedAsset(outDir, 640, Buffer.from('bytes-640'));
    expect(() =>
      verifySnapshotLocalAssets({
        entries: { [URL]: { href, srcSet: `${href} 1280w` } },
        outDir,
        urls: [URL],
      })
    ).toThrow(/does not match file width/);
  });

  it('fails on an empty srcSet and descriptor-less candidates', () => {
    const outDir = setup();
    const href = seedAsset(outDir, 640, Buffer.from('bytes-640'));
    expect(() =>
      verifySnapshotLocalAssets({
        entries: { [URL]: { href, srcSet: '   ' } },
        outDir,
        urls: [URL],
      })
    ).toThrow(/srcSet has no candidates/);
    expect(() =>
      verifySnapshotLocalAssets({
        entries: { [URL]: { href, srcSet: href } },
        outDir,
        urls: [URL],
      })
    ).toThrow(/missing its width descriptor/);
  });

  it('fails on off-origin and unmanaged references', () => {
    const outDir = setup();
    expect(() =>
      verifySnapshotLocalAssets({
        entries: {
          [URL]: {
            href: 'https://evil.example/x.avif',
            srcSet: '/_hero/ogabassey/hand-dropped.avif 640w',
          },
        },
        outDir,
        urls: [URL],
      })
    ).toThrow(/not a snapshot path in/);
  });

  it('fails on encoded traversal, deep paths, and slug mismatches', () => {
    const outDir = setup();
    const good = seedAsset(outDir, 640, Buffer.from('bytes-640'));
    const fileName = good.split('/').pop();
    for (const badHref of [
      `/_hero/ogabassey/%2e%2e/${fileName}`,
      `/_hero/ogabassey/%252e%252e-640.avif`,
      `/_hero/ogabassey/../ogabassey/${fileName}`,
      `/_hero/other/${fileName}`,
    ]) {
      expect(() =>
        verifySnapshotLocalAssets({
          entries: { [URL]: { href: badHref, srcSet: `${good} 640w` } },
          outDir,
          urls: [URL],
        })
      ).toThrow(/not a (same-origin snapshot|snapshot path in)/);
    }
  });
});
