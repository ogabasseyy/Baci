// Snapshot baking and orphan pruning for the hero snapshot pipeline.

import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  DEFAULT_WIDTH,
  MANAGED_FILE_PATTERN,
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
  for (const sourceUrl of urls) {
    // eslint-disable-next-line no-await-in-loop
    const sourceBytes = await fetchSnapshotSource(sourceUrl, fetchImpl);
    const sourceSha256 = createHash('sha256').update(sourceBytes).digest('hex');
    // eslint-disable-next-line no-await-in-loop
    const meta = await sharpImpl(sourceBytes).metadata();
    const sourceWidth = meta.width ?? 0;
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
      const fileHash = createHash('sha256').update(encoded).digest('hex').slice(0, 12);
      const fileName = `${fileHash}-${width}.avif`;
      const filePath = resolve(outDir, fileName);
      writeFileSync(filePath, encoded);
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
    entries.push({
      sourceUrl,
      srcSet: candidates.join(', '),
      href: `/_hero/${slug}/${filesByWidth.get(hrefWidth)}`,
      quality: SNAPSHOT_QUALITY,
      widths: [...SNAPSHOT_WIDTHS].sort((a, b) => a - b),
      sourceSha256,
    });
  }
  return entries;
}

export function pruneSnapshotOrphans(outDir, entries) {
  const referenced = new Set();
  for (const entry of entries) {
    referenced.add(entry.href.split('/').pop());
    for (const part of entry.srcSet.split(',')) {
      const file = part.trim().split(/\s+/)[0].split('/').pop();
      if (file) referenced.add(file);
    }
  }
  const pruned = [];
  for (const file of readdirSync(outDir)) {
    // Only ever delete files this pipeline could have written.
    if (!MANAGED_FILE_PATTERN.test(file) || referenced.has(file)) {
      continue;
    }
    rmSync(resolve(outDir, file));
    pruned.push(file);
    console.log(`[hero-snapshots] pruned orphan ${file}`);
  }
  return pruned;
}
