// Snapshot baking for the hero snapshot pipeline.

import { createHash } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  DEFAULT_WIDTH,
  SNAPSHOT_QUALITY,
  SNAPSHOT_WIDTHS,
  snapshotError,
} from './ogabassey-hero-snapshot-config.mjs';
import { fetchSnapshotSource } from './ogabassey-hero-snapshot-source.mjs';

export async function bakeSnapshots({
  fetchImpl,
  outDir,
  sharpImpl,
  slug,
  urls,
}) {
  mkdirSync(outDir, { recursive: true });
  const entries = [];
  // Rollback set: if any URL fails after earlier ones baked, remove this
  // run's files so a failed invocation never leaves unreferenced AVIFs in
  // the checked-in public directory for someone to commit accidentally.
  const bakedPaths = [];
  try {
    for (const sourceUrl of urls) {
      // eslint-disable-next-line no-await-in-loop
      entries.push(
        await bakeOneUrl({
          bakedPaths,
          fetchImpl,
          outDir,
          sharpImpl,
          slug,
          sourceUrl,
        })
      );
    }
  } catch (error) {
    for (const filePath of bakedPaths) {
      rmSync(filePath, { force: true });
    }
    throw error;
  }
  return entries;
}

async function bakeOneUrl({
  bakedPaths,
  fetchImpl,
  outDir,
  sharpImpl,
  slug,
  sourceUrl,
}) {
  const sourceBytes = await fetchSnapshotSource(sourceUrl, fetchImpl);
  const sourceSha256 = createHash('sha256').update(sourceBytes).digest('hex');
  const meta = await sharpImpl(sourceBytes).metadata();
  // Validate the AUTO-ORIENTED width: `.rotate()` below swaps EXIF 5-8
  // dimensions, so the raw metadata width would wrongly reject a
  // portrait-stored landscape image.
  const swapsDimensions =
    typeof meta.orientation === 'number' &&
    meta.orientation >= 5 &&
    meta.orientation <= 8;
  const sourceWidth = swapsDimensions ? (meta.height ?? 0) : (meta.width ?? 0);
  if (sourceWidth < Math.max(...SNAPSHOT_WIDTHS)) {
    // Never upscale: a source smaller than the widest snapshot would bake
    // blur. Fail loudly so the old manifest stays deployed instead.
    throw snapshotError(
      `${sourceUrl} is ${sourceWidth}px wide, need >= ${Math.max(...SNAPSHOT_WIDTHS)}px`
    );
  }
  const filesByWidth = new Map();
  for (const width of SNAPSHOT_WIDTHS) {
    // `.rotate()` first, mirroring the CDN transformer
    // (infra/cdn-transformer/transform-cache.mjs): without auto-orientation
    // an EXIF-rotated source would bake sideways. No-op for sources
    // without an orientation tag.
    // Encode to a buffer: the filename hash covers the ENCODED bytes, so
    // a quality/encoder/sharp change mints a new URL instead of
    // overwriting an `immutable`-cached one.
    // eslint-disable-next-line no-await-in-loop
    const encoded = await sharpImpl(sourceBytes)
      .rotate()
      .resize({ width, withoutEnlargement: true })
      .avif({ quality: SNAPSHOT_QUALITY, effort: 4 })
      .toBuffer();
    const fileHash = createHash('sha256')
      .update(encoded)
      .digest('hex')
      .slice(0, 12);
    const fileName = `${fileHash}-${width}.avif`;
    const filePath = resolve(outDir, fileName);
    writeFileSync(filePath, encoded);
    bakedPaths.push(filePath);
    // eslint-disable-next-line no-await-in-loop
    const baked = await sharpImpl(filePath).metadata();
    if (baked.width !== width || baked.format !== 'heif') {
      throw snapshotError(
        `${fileName}: baked ${baked.width}px/${baked.format}, want ${width}px/avif`
      );
    }
    filesByWidth.set(width, fileName);
    console.log(`[hero-snapshots] baked ${fileName}`);
  }
  const candidates = [...filesByWidth.entries()]
    .sort(([a], [b]) => a - b)
    .map(([width, fileName]) => `/_hero/${slug}/${fileName} ${width}w`);
  const hrefWidth = [...SNAPSHOT_WIDTHS].sort(
    (a, b) => Math.abs(a - DEFAULT_WIDTH) - Math.abs(b - DEFAULT_WIDTH)
  )[0];
  return {
    sourceUrl,
    srcSet: candidates.join(', '),
    href: `/_hero/${slug}/${filesByWidth.get(hrefWidth)}`,
    quality: SNAPSHOT_QUALITY,
    widths: [...SNAPSHOT_WIDTHS].sort((a, b) => a - b),
    sourceSha256,
  };
}
