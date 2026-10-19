import assert from 'node:assert/strict';
import test from 'node:test';
import { buildRungRows, tierCells } from './quality-sheet-render.mjs';

test('sizes an uncropped wide tier to the slot CSS width', () => {
  // The displayed box is always the slot CSS width: a 2000px tier
  // shows its inspection raster at 96px CSS like the original, with
  // the encoded 2000w kept as caption provenance.
  const cells = tierCells(
    {
      bytes: 10,
      contentType: 'image/avif',
      format: 'avif',
      height: 500,
      path: 'wide.avif',
      quality: 70,
      sha256: 'f'.repeat(64),
      width: 2000,
    },
    {
      bytes: Buffer.from('raster-bytes'),
      capped: false,
      contentType: 'image/png',
      width: 96,
    },
    null,
    96
  );
  assert.match(cells, /<img[^>]*style="width:96px;height:auto"/);
  assert.match(cells, /data:image\/png;base64,/);
  assert.match(cells, /96px raster/);
  assert.doesNotMatch(cells, /max-width/);
});

test('labels original-passthrough tiers instead of printing qnull', () => {
  // Passthrough tiers carry quality null (no encode happened): the
  // caption must say so explicitly, not imply a reviewed quality.
  const cells = tierCells(
    {
      bytes: 10,
      contentType: 'image/avif',
      delivery: 'original-passthrough',
      format: 'avif',
      height: 48,
      path: 'pass.avif',
      quality: null,
      sha256: 'e'.repeat(64),
      width: 48,
    },
    {
      bytes: Buffer.from('raster-bytes'),
      capped: true,
      contentType: 'image/png',
      width: 48,
    },
    null,
    48
  );
  assert.match(cells, /passthrough \(no encode\)/);
  assert.match(cells, /48px raster · encoded-pixel ceiling/);
  assert.doesNotMatch(cells, /qnull/);
});

test('buildRungRows carries DPR pixel density in same-width boxes', async () => {
  // White-box on the row builder: decode every embedded raster and
  // prove the widths — DPR 1/2/3 rasters at 40/80/120px for the wide
  // original, while the narrow tier caps independently at 96px on
  // DPR 3 instead of inheriting a rung floor. Every box displays at
  // the 40px slot width.
  const sharp = (await import('sharp')).default;
  const source = await sharp({
    create: { background: '#336699', channels: 3, height: 500, width: 500 },
  })
    .png()
    .toBuffer();
  const tierBytes = await sharp({
    create: { background: '#993366', channels: 3, height: 96, width: 96 },
  })
    .png()
    .toBuffer();
  const tiers = [
    {
      bytes: tierBytes.length,
      contentType: 'image/avif',
      delivery: 'generated',
      format: 'avif',
      height: 96,
      path: 'tier.avif',
      quality: 70,
      requestedWidth: 96,
      sha256: 'f'.repeat(64),
      width: 96,
    },
  ];
  const { embeddedBytes, html } = await buildRungRows({
    crop: null,
    files: new Map([['tier.avif', tierBytes]]),
    geometry: { cssWidth: 40 },
    mountNote: '',
    record: { height: 500, width: 500 },
    requestedWidth: 96,
    snapshotBytes: source,
    snapshotWidth: 500,
    tiers,
  });
  // Every image (original plus tier per row) displays at the slot
  // CSS width — originals end the style there, tiers continue with
  // height:auto, so accept either terminator.
  assert.equal(
    [...html.matchAll(/style="width:(\d+)px[;"]/g)]
      .map((m) => m[1])
      .join(','),
    '40,40,40,40,40,40'
  );
  // Original plus one tier per DPR row: the original carries
  // 40/80/120px while the 96px tier caps its own DPR-3 raster at 96.
  const rasters = [...html.matchAll(/data:image\/png;base64,([^"]+)/g)];
  assert.equal(rasters.length, 6);
  const widths = [];
  for (const [, payload] of rasters) {
    const meta = await sharp(Buffer.from(payload, 'base64')).metadata();
    widths.push(meta.width);
  }
  assert.deepEqual(widths, [40, 40, 80, 80, 120, 96]);
  assert.match(html, /96px raster · encoded-pixel ceiling/);
  // The reported cost covers every raster occurrence, base64-inflated.
  assert.ok(embeddedBytes > 0);
  assert.equal(
    embeddedBytes,
    rasters.reduce(
      (sum, [, payload]) => sum + 'data:image/png;base64,'.length + payload.length,
      0
    )
  );
});

test('buildRungRows auto-orients EXIF-rotated bytes before resizing', async () => {
  // Stored 100x50 with EXIF orientation 6 (rotate 90 CW): the
  // oriented image is 50x100, so the DPR-1 raster at 40px wide must
  // be 40x80 — resizing the stored axes would emit 40x20 and review
  // a differently rotated image than the browser shows.
  const sharp = (await import('sharp')).default;
  const source = await sharp({
    create: { background: '#669933', channels: 3, height: 50, width: 100 },
  })
    .jpeg()
    .withMetadata({ orientation: 6 })
    .toBuffer();
  const tierBytes = await sharp({
    create: { background: '#993366', channels: 3, height: 96, width: 96 },
  })
    .png()
    .toBuffer();
  const { html } = await buildRungRows({
    crop: null,
    files: new Map([['tier.avif', tierBytes]]),
    geometry: { cssWidth: 40 },
    mountNote: '',
    record: { height: 100, width: 50 },
    requestedWidth: 96,
    snapshotBytes: source,
    snapshotWidth: 50,
    tiers: [
      {
        bytes: tierBytes.length,
        contentType: 'image/avif',
        delivery: 'generated',
        format: 'avif',
        height: 96,
        path: 'tier.avif',
        quality: 70,
        requestedWidth: 96,
        sha256: 'f'.repeat(64),
        width: 96,
      },
    ],
  });
  const [first] = [...html.matchAll(/data:image\/png;base64,([^"]+)/g)];
  const meta = await sharp(Buffer.from(first[1], 'base64')).metadata();
  assert.equal(meta.width, 40);
  assert.equal(meta.height, 80);
});

