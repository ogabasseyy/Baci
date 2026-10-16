import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import {
  assertSnapshotMatchesSource,
  snapshotFormat,
} from './lab-source-verify';

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

  it('normalizes the HEIF container to AVIF for AV1-coded stills', async () => {
    // Sharp reports AVIF bytes as format `heif` with compression `av1`;
    // without the generator's normalization every accepted AVIF source
    // (including the sampled AVIF hero) fails staging and loading.
    const snapshot = await sharp({
      create: {
        background: '#ffffff',
        channels: 3,
        height: 8,
        width: 8,
      },
    })
      .avif()
      .toBuffer();
    await expect(
      assertSnapshotMatchesSource(
        snapshot,
        {
          bytes: snapshot.length,
          format: 'avif',
          orientedHeight: 8,
          orientedWidth: 8,
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

  it('rejects a hash-matching source past the axis ceiling', async () => {
    const snapshot = await sharp({
      create: { background: '#ffffff', channels: 3, height: 1, width: 20000 },
    })
      .png()
      .toBuffer();
    const source = {
      bytes: snapshot.length,
      format: 'png',
      orientedHeight: 1,
      orientedWidth: 20000,
    };
    await expect(
      assertSnapshotMatchesSource(snapshot, source, 'merchant/slot')
    ).rejects.toThrow(/beyond the generator axis limit/);
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

  it('rejects a header-readable but pixel-truncated snapshot', async () => {
    // corrupt-truncated.jpg carries a valid header (metadata reports its
    // format and dimensions) with a premature-end pixel payload: a
    // header-only verifier would certify the manifest facts below, but
    // browsers cannot decode the staged bytes.
    const snapshot = await readFile(
      join(GENERATOR_FIXTURES, 'corrupt-truncated.jpg')
    );
    const header = await sharp(snapshot).metadata();
    await expect(
      assertSnapshotMatchesSource(
        snapshot,
        {
          bytes: snapshot.length,
          format: 'jpeg',
          orientedHeight: header.height as number,
          orientedWidth: header.width as number,
        },
        'merchant/slot'
      )
    ).rejects.toThrow(/does not fully decode/);
  });

  it('rejects animated bytes like the generator does', async () => {
    // Classic 1x1 GIF with its frame block spliced twice: sharp reports
    // pages 2. The pilot certifies stills only, so animation fails before
    // any source-fact comparison.
    const frame = Buffer.from(
      'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
      'base64'
    );
    const animated = Buffer.concat([
      frame.subarray(0, frame.length - 1),
      frame.subarray(19, frame.length - 1),
      frame.subarray(frame.length - 1),
    ]);
    await expect(
      assertSnapshotMatchesSource(
        animated,
        {
          bytes: animated.length,
          format: 'gif',
          orientedHeight: 1,
          orientedWidth: 1,
        },
        'merchant/slot'
      )
    ).rejects.toThrow(/animated/);
  });
});

describe('snapshotFormat', () => {
  it('names a still accepted-format snapshot from its bytes', async () => {
    const snapshot = await readFile(join(GENERATOR_FIXTURES, 'tiny-48x48.png'));
    await expect(snapshotFormat(snapshot, 'merchant/slot')).resolves.toBe(
      'png'
    );
  });

  it('rejects an active SVG instead of staging it under the public tree', async () => {
    // Metadata alone reports `svg` and the extension map would stage it
    // as same-origin active content while every hash check passes.
    const snapshot = await readFile(
      join(GENERATOR_FIXTURES, 'vector-image.svg')
    );
    await expect(snapshotFormat(snapshot, 'merchant/slot')).rejects.toThrow(
      /decodes as "svg"/
    );
  });

  it('rejects animated bytes before naming a suffix', async () => {
    const snapshot = await readFile(
      join(GENERATOR_FIXTURES, 'anim-2frame.webp')
    );
    await expect(snapshotFormat(snapshot, 'merchant/slot')).rejects.toThrow(
      /animated/
    );
  });

  it('rejects a still GIF: not a generator input, so no suffix', async () => {
    // Single-frame GIF passes the stills and full-decode gates but is
    // outside the generator's accepted inputs — staging it would
    // publish a baseline the pilot can never optimize.
    const snapshot = await sharp({
      create: {
        background: '#ffffff',
        channels: 3,
        height: 4,
        width: 4,
      },
    })
      .gif()
      .toBuffer();
    await expect(snapshotFormat(snapshot, 'merchant/slot')).rejects.toThrow(
      /decodes as "gif"/
    );
  });

  it('rejects a decodable snapshot past the generator axis ceiling', async () => {
    // 20,000x1 fully decodes under the 40M-pixel Sharp limit, but the
    // generator caps each axis at 16,384: staging it would publish an
    // original assertAcceptedMetadata rejects on sight.
    const snapshot = await sharp({
      create: {
        background: '#ffffff',
        channels: 3,
        height: 1,
        width: 20000,
      },
    })
      .png()
      .toBuffer();
    await expect(snapshotFormat(snapshot, 'merchant/slot')).rejects.toThrow(
      /axes are capped at 16384/
    );
  });

  it('rejects a header-readable but pixel-truncated snapshot', async () => {
    const snapshot = await readFile(
      join(GENERATOR_FIXTURES, 'corrupt-truncated.jpg')
    );
    await expect(snapshotFormat(snapshot, 'merchant/slot')).rejects.toThrow(
      /does not fully decode/
    );
  });
});
