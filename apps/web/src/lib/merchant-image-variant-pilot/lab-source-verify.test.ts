import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { assertSnapshotMatchesSource } from './lab-source-verify';

const here = dirname(fileURLToPath(import.meta.url));
const GENERATOR_FIXTURES = join(
  here,
  '..',
  '..',
  '..',
  '..',
  '..',
  'infra',
  'cdn-transformer',
  'pilot',
  'fixtures'
);

// Portrait buffer stored as 6x4 with EXIF orientation 6: decoders render
// it as 4x6, so only the oriented claim verifies.
async function orientedJpeg(): Promise<Buffer> {
  return sharp({
    create: {
      background: '#ffffff',
      channels: 3,
      height: 4,
      width: 6,
    },
  })
    .jpeg()
    .withMetadata({ orientation: 6 })
    .toBuffer();
}

describe('assertSnapshotMatchesSource', () => {
  it('resolves when the decoded facts match the manifest source', async () => {
    const snapshot = await readFile(join(GENERATOR_FIXTURES, 'tiny-48x48.png'));
    await expect(
      assertSnapshotMatchesSource(
        snapshot,
        {
          bytes: snapshot.length,
          format: 'png',
          orientedHeight: 48,
          orientedWidth: 48,
        },
        'merchant/slot'
      )
    ).resolves.toBeUndefined();
  });

  it('rejects a format the bytes do not decode as', async () => {
    const snapshot = await readFile(join(GENERATOR_FIXTURES, 'tiny-48x48.png'));
    await expect(
      assertSnapshotMatchesSource(
        snapshot,
        {
          bytes: snapshot.length,
          format: 'jpeg',
          orientedHeight: 48,
          orientedWidth: 48,
        },
        'merchant/slot'
      )
    ).rejects.toThrow(/decodes as "png" but .* claims "jpeg"/);
  });

  it('rejects dimensions the oriented decode disproves', async () => {
    const snapshot = await readFile(join(GENERATOR_FIXTURES, 'tiny-48x48.png'));
    await expect(
      assertSnapshotMatchesSource(
        snapshot,
        {
          bytes: snapshot.length,
          format: 'png',
          orientedHeight: 49,
          orientedWidth: 48,
        },
        'merchant/slot'
      )
    ).rejects.toThrow(/48x48.*claims 48x49/);
  });

  it('rejects a byte size the snapshot disproves', async () => {
    const snapshot = await readFile(join(GENERATOR_FIXTURES, 'tiny-48x48.png'));
    await expect(
      assertSnapshotMatchesSource(
        snapshot,
        { bytes: 10, format: 'png', orientedHeight: 48, orientedWidth: 48 },
        'merchant/slot'
      )
    ).rejects.toThrow(/claims 48x48 \(10 B\)/);
  });

  it('verifies EXIF-oriented dimensions, not stored axes', async () => {
    const snapshot = await orientedJpeg();
    await expect(
      assertSnapshotMatchesSource(
        snapshot,
        {
          bytes: snapshot.length,
          format: 'jpeg',
          orientedHeight: 6,
          orientedWidth: 4,
        },
        'merchant/slot'
      )
    ).resolves.toBeUndefined();
    await expect(
      assertSnapshotMatchesSource(
        snapshot,
        {
          bytes: snapshot.length,
          format: 'jpeg',
          orientedHeight: 4,
          orientedWidth: 6,
        },
        'merchant/slot'
      )
    ).rejects.toThrow(/4x6.*claims 6x4/);
  });
});
