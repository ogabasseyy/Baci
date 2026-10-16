// Quality-sheet rendering helpers: escaping and tier cells.
// Mount-crop parsing lives in quality-sheet-mounts.mjs; orchestration
// (generation lookup, sheet assembly, CLI) stays in quality-sheet.mjs,
// which re-exports PilotSheetError.
import sharp from 'sharp';
import { RESAMPLE_PIPELINE } from './constants.mjs';
import { desiredInspectionWidth } from './quality-sheet-inspect.mjs';
import { PilotSheetError } from './quality-sheet-mounts.mjs';
import {
  normalizeFormat,
  orientedDimensions,
} from './encode-worker-formats.mjs';

export function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

// Bind the schema-blind source claims to the verified snapshot bytes:
// the generation id covers the source hash but not its format, byte
// count, or dimensions, so a schema-valid stored manifest mislabeling
// any of them would otherwise embed a broken baseline or misjudge
// never-larger while its derivatives render normally. Dimensions need
// the check too: the schema binds tiers RELATIVE to the source claims
// (widths clamp via min(requested, oriented)), so a consistent
// geometry lie — shrunken source plus shrunken tiers — passes schema.
// Only the decode anchors the claims to reality. Header-level metadata
// suffices — container magic identifies the format without a pixel
// decode.
export async function assertSnapshotSource(snapshotBytes, source, assetId) {
  let meta;
  try {
    meta = await sharp(snapshotBytes).metadata();
  } catch {
    throw new PilotSheetError(
      `snapshot for asset "${assetId}" does not decode`
    );
  }
  const decoded = normalizeFormat(meta);
  if (decoded !== source.format) {
    throw new PilotSheetError(
      `snapshot for asset "${assetId}" decodes as ${decoded ?? 'unknown'} but the manifest claims ${source.format}`
    );
  }
  if (snapshotBytes.length !== source.bytes) {
    throw new PilotSheetError(
      `snapshot for asset "${assetId}" is ${snapshotBytes.length} bytes but the manifest claims ${source.bytes}`
    );
  }
  // Exact: source claims are measured from these same bytes at
  // acquisition, so any deviation is a misbound manifest, not rounding.
  const oriented = orientedDimensions(meta);
  if (
    oriented.width !== source.orientedWidth ||
    oriented.height !== source.orientedHeight
  ) {
    throw new PilotSheetError(
      `snapshot for asset "${assetId}" decodes as ${oriented.width}x${oriented.height} but the manifest claims ${source.orientedWidth}x${source.orientedHeight}`
    );
  }
  // Return the verified oriented size: callers must cap arithmetic by
  // THIS, never by the record's width/height labels (unvalidated
  // inventory metadata — only safe escaped into captions).
  return { height: oriented.height, width: oriented.width };
}

// Bind each tier's claimed geometry to its verified bytes before
// rendering. Mirrors the encoder's own output tolerance (verifyVariant):
// width exact, height ±1px for resampling rounding. Honest claims record
// the encoder prediction exactly, so anything wider is a misbound
// manifest — including ±1-stack lies the schema's own tolerance admits.
export async function assertTierDecodedDimensions(tier, files, assetId) {
  const bytes = files.get(tier.path);
  if (!bytes) {
    throw new PilotSheetError(
      `tier "${tier.path}" for asset "${assetId}" has no verified bytes`
    );
  }
  let meta;
  try {
    meta = await sharp(bytes).metadata();
  } catch {
    throw new PilotSheetError(
      `tier "${tier.path}" for asset "${assetId}" does not decode`
    );
  }
  // Manifest tier claims are oriented dimensions: encoded tiers are
  // EXIF-normalized at encode time (orientation 1, so oriented() is the
  // raw axes), but original-passthrough tiers carry the source's own
  // EXIF bytes and claim its oriented axes. Comparing raw axes would
  // reject a valid rotated passthrough as a geometry mismatch.
  const oriented = orientedDimensions(meta);
  if (
    oriented.width !== tier.width ||
    Math.abs((oriented.height ?? -1) - tier.height) > 1
  ) {
    throw new PilotSheetError(
      `tier "${tier.path}" for asset "${assetId}" decodes as ${oriented.width}x${oriented.height} but the manifest claims ${tier.width}x${tier.height}`
    );
  }
}

export function tierCells(tier, display, crop, boxWidth) {
  // display carries the inspection raster bytes plus their MIME (PNG
  // resamples, not the raw tier bytes): the caption keeps the tier's
  // ENCODED facts (format, width, quality, bytes, hash) as provenance
  // while the image shows what each DPR screen samples, and the
  // raster width records this candidate's own pixel density (each
  // candidate caps independently by its physical width — never by a
  // narrower sibling rung-mate).
  const dataUri = `data:${display.contentType};base64,${display.bytes.toString('base64')}`;
  const rasterNote = ` · ${display.width}px raster${display.capped ? ' · encoded-pixel ceiling' : ''}`;
  // height:auto keeps the aspect ratio at the row width: without it the
  // browser stretches the tier to height=. Every tier renders at the
  // slot CSS width like the original — DPR changes the raster's pixel
  // density, never the displayed box.
  const overSource =
    tier.delivery === 'generated-over-source' ? ' · over-source' : '';
  // Original-passthrough tiers carry no encode (quality null by
  // contract): label them explicitly instead of printing 'qnull',
  // which would imply a reviewed encode quality for exactly the
  // rungs whose never-larger claim rests on source-byte reuse.
  const qualityNote =
    tier.delivery === 'original-passthrough'
      ? 'passthrough (no encode)'
      : `q${tier.quality}`;
  const style =
    crop === null
      ? `width:${boxWidth}px;height:auto`
      : `width:${boxWidth}px;aspect-ratio:${crop.aspectRatio};object-fit:${crop.fit};object-position:${crop.position}`;
  return `<figure><img src="${dataUri}" width="${tier.width}" height="${tier.height}" alt="${escapeHtml(tier.format)} ${tier.width}w" style="${style}"/><figcaption>${escapeHtml(tier.format)} ${tier.width}w · ${qualityNote} · ${tier.bytes} B${rasterNote}${overSource}<br><code>${escapeHtml(tier.sha256.slice(0, 16))}…</code></figcaption></figure>`;
}

// Explicit DPR rows per rung: the design spec requires inspection at
// the actual CSS slot size for DPR 1/2/3 — the displayed box stays at
// the slot CSS width on every row while the inspection raster carries
// that DPR's pixel density (device pixels per CSS pixel), capped by
// the narrowest encoded tier (never upscaled).
const DPR_LEVELS = [1, 2, 3];

const base64Length = (bytes) => 4 * Math.ceil(bytes / 3);

// Inspection raster: the verified bytes auto-oriented (EXIF 5-8
// sources would otherwise resize the stored axes and emit a PNG that
// no longer carries the correction — a differently rotated review
// than the browser shows) and resampled to the DPR width as lossless
// PNG (no second lossy encode to judge — the tier's own codec
// artifacts are baked into its pixels and survive the downsample).
// Inputs are already hash-bound verified buffers, so no
// re-verification here; the caller charges the raster bytes.
async function resampleForInspection(bytes, rasterWidth) {
  // Kernel+orient shared with the generation pipeline (recipe
  // identity): review pixels match browser orientation. No upscale
  // clamp — raster widths are capped at the physical width upstream.
  const pipeline = sharp(bytes);
  if (RESAMPLE_PIPELINE.orient === 'auto') {
    pipeline.rotate();
  }
  return pipeline
    .resize({ kernel: sharp.kernel[RESAMPLE_PIPELINE.kernel], width: rasterWidth })
    .png()
    .toBuffer();
}

// One rung's DPR rows plus their exact embed cost, so the caller can
// fail the aggregate budget BEFORE appending the HTML. Returns html
// for all three DPR rows and the base64-inflated byte count the rows
// add (prefixes plus rasters, original and tiers alike).
export async function buildRungRows({
  crop,
  files,
  geometry,
  mountNote,
  record,
  requestedWidth,
  snapshotBytes,
  snapshotHeight,
  snapshotWidth,
  tiers,
}) {
  let embeddedBytes = 0;
  const rows = [];
  for (const dpr of DPR_LEVELS) {
    // Per-candidate caps on VERIFIED widths (never record labels),
    // with cover-crop mounts boosted so the visible crop carries
    // full density — and nothing ever upscales.
    const desiredOriginal = desiredInspectionWidth(
      geometry.cssWidth, dpr, snapshotWidth, snapshotHeight, crop
    );
    const originalWidth = Math.min(desiredOriginal, snapshotWidth);
    const originalRaster = await resampleForInspection(
      snapshotBytes,
      originalWidth
    );
    const originalUri = `data:image/png;base64,${originalRaster.toString('base64')}`;
    embeddedBytes += 'data:image/png;base64,'.length + base64Length(originalRaster.length);
    const tierCellsHtml = [];
    for (const tier of tiers) {
      const desiredTier = desiredInspectionWidth(
        geometry.cssWidth,
        dpr,
        tier.width,
        tier.height,
        crop
      );
      const tierWidth = Math.min(desiredTier, tier.width);
      const raster = await resampleForInspection(
        files.get(tier.path),
        tierWidth
      );
      embeddedBytes += 'data:image/png;base64,'.length + base64Length(raster.length);
      tierCellsHtml.push(
        `<td>${tierCells(tier, { bytes: raster, capped: tierWidth < desiredTier, contentType: 'image/png', width: tierWidth }, crop, geometry.cssWidth)}</td>`
      );
    }
    const ceilingNote = originalWidth < desiredOriginal ? ' · encoded-pixel ceiling' : '';
    const originalStyle =
      crop === null
        ? `width:${geometry.cssWidth}px`
        : `width:${geometry.cssWidth}px;aspect-ratio:${crop.aspectRatio};object-fit:${crop.fit};object-position:${crop.position}`;
    rows.push(`<tr><td>${requestedWidth}px tier · DPR ${dpr}</td>
<td><figure><img src="${originalUri}" style="${originalStyle}" alt="original resampled to ${originalWidth}px, shown at ${geometry.cssWidth}px"/><figcaption>original · ${snapshotBytes.length} B · ${escapeHtml(record.width)}x${escapeHtml(record.height)} · compared at ${geometry.cssWidth}px CSS · DPR ${dpr} (${originalWidth}px inspection raster${ceilingNote})${mountNote}</figcaption></figure></td>
${tierCellsHtml.join('\n')}</tr>`);
  }
  return { embeddedBytes, html: rows.join('\n') };
}
