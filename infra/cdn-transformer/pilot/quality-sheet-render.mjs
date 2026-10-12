// Quality-sheet rendering helpers: escaping, mount-crop parsing, and
// tier cells. Orchestration (generation lookup, sheet assembly, CLI)
// stays in quality-sheet.mjs, which re-exports PilotSheetError.
import sharp from 'sharp';
import { normalizeFormat } from './encode-worker-formats.mjs';

export class PilotSheetError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PilotSheetError';
  }
}

export function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

// Source MIME derivation from the VERIFIED manifest source format —
// never from the inventory record's contentType label, which is
// unvalidated metadata. A stale-but-allowlisted label (PNG bytes
// marked image/jpeg) or a missing one (defaulting to PNG) would embed
// the baseline under the wrong MIME and show a broken or
// browser-sniffed original next to normally rendering derivatives.
// The format comes from the schema-validated manifest source whose
// sha256 the sheet already rebound to the verified snapshot bytes, so
// the map is total; unknown values still fail closed.
const MIME_FOR_SOURCE_FORMAT = {
  avif: 'image/avif',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

export function originalContentType(sourceFormat, assetId) {
  const contentType = MIME_FOR_SOURCE_FORMAT[sourceFormat];
  if (!contentType) {
    throw new PilotSheetError(
      `unsupported original source format for asset "${assetId}"`
    );
  }
  return escapeHtml(contentType);
}

// Bind the schema-blind source claims to the verified snapshot bytes:
// the generation id covers the source hash but not its format or byte
// count, so a schema-valid stored manifest mislabeling either would
// otherwise embed a broken baseline or misjudge never-larger while its
// derivatives render normally. (Dimensions need no decode check: the
// ladder width and aspect bindings determine them — any dims lie fails
// schema validation first.) Header-level metadata suffices — container
// magic identifies the format without a pixel decode.
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
}

export function tierCells(tier, files, cssWidth, crop, boxWidth) {
  const file = files.get(tier.path);
  const dataUri = `data:${tier.contentType};base64,${file.toString('base64')}`;
  // height:auto keeps the aspect ratio when the DPR-3 cap constrains
  // the width: without it the browser stretches the tier to height=.
  const overSource =
    tier.delivery === 'generated-over-source' ? ' · over-source' : '';
  const style =
    crop === null
      ? `max-width:${cssWidth * 3}px;height:auto`
      : `width:${boxWidth}px;aspect-ratio:${crop.aspectRatio};object-fit:${crop.fit};object-position:${crop.position}`;
  return `<figure><img src="${dataUri}" width="${tier.width}" height="${tier.height}" alt="${escapeHtml(tier.format)} ${tier.width}w" style="${style}"/><figcaption>${escapeHtml(tier.format)} ${tier.width}w · q${tier.quality} · ${tier.bytes} B${overSource}<br><code>${escapeHtml(tier.sha256.slice(0, 16))}…</code></figcaption></figure>`;
}

// Mounted-crop contract: cropped consumers (product card 16:9 cover,
// header logo circular cover) clip content the intrinsic-aspect render
// hides, so a sheet that ignores the mount can certify an image whose
// branding the real mount cuts off. The slot geometry may carry the
// mount box — { aspectRatio: '16 / 9', fit: 'cover', position: '50% 50%' }
// — and both original and derivatives then render inside that real CSS
// box at the row's size-matched width. Malformed mounts fail closed: a
// silently misrendered mount is worse than no sheet.
const MOUNT_FITS = new Set(['cover', 'contain']);
const MOUNT_POSITION_PATTERN =
  /^(center|left|right|top|bottom|\d{1,3}%)( (center|left|right|top|bottom|\d{1,3}%))?$/;

// Canonical mounts for fixed-geometry cropped slots, mirroring the lab
// consumers (keep in sync with the cited components): the product card
// paints aspect-video object-cover, the header logo a 40x40 rounded-full
// object-cover box (1/1 cover is its crop equivalent). Slots without an
// entry keep the legacy intrinsic render when --slots omits the mount —
// mobile-hero-slide-0 is deliberately absent (its fit is data-driven,
// contain or cover per projection, so no single canonical mount fits).
// An explicit --slots mount always wins over the canonical default.
const CANONICAL_SLOT_MOUNTS = {
  // apps/web/src/lib/merchant-image-variant-pilot/lab-product-card-image.tsx
  'product-card': { aspectRatio: '16 / 9', fit: 'cover', position: '50% 50%' },
  // apps/web/src/lib/merchant-image-variant-pilot/lab-header-logo.tsx
  'header-logo': { aspectRatio: '1 / 1', fit: 'cover', position: '50% 50%' },
};

export function parseMountCrop(geometry, slot) {
  let mount = geometry?.mount;
  if (mount === undefined) {
    mount = CANONICAL_SLOT_MOUNTS[slot];
  }
  if (mount === undefined) {
    return null;
  }
  const fail = (why) => {
    throw new PilotSheetError(`invalid mount for slot "${slot}": ${why}`);
  };
  if (typeof mount !== 'object' || mount === null || Array.isArray(mount)) {
    fail('mount must be an object');
  }
  const ratio = /^(\d{1,4})\s*\/\s*(\d{1,4})$/.exec(mount.aspectRatio ?? '');
  if (!ratio || Number(ratio[1]) < 1 || Number(ratio[2]) < 1) {
    fail('aspectRatio must look like "16 / 9"');
  }
  if (!MOUNT_FITS.has(mount.fit)) {
    fail('fit must be "cover" or "contain"');
  }
  if (
    typeof mount.position !== 'string' ||
    !MOUNT_POSITION_PATTERN.test(mount.position)
  ) {
    fail('position must be CSS position keywords or percents');
  }
  return {
    aspectRatio: `${ratio[1]} / ${ratio[2]}`,
    fit: mount.fit,
    position: mount.position,
  };
}
