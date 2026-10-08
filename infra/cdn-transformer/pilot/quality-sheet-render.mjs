// Quality-sheet rendering helpers: escaping, mount-crop parsing, and
// tier cells. Orchestration (generation lookup, sheet assembly, CLI)
// stays in quality-sheet.mjs, which re-exports PilotSheetError.

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

// Source MIME allowlist, mirroring the keys of
// EXTENSION_FOR_CONTENT_TYPE in acquire.mjs: the inventory value lands
// inside an <img src> data URI, so anything outside the acquired-source
// set (in particular a string with a quote) would break into
// operator-executed markup.
const ORIGINAL_CONTENT_TYPES = new Set([
  'image/avif',
  'image/jpeg',
  'image/png',
  'image/webp',
]);

export function originalContentType(record) {
  const contentType = record.contentType ?? 'image/png';
  if (!ORIGINAL_CONTENT_TYPES.has(contentType)) {
    throw new PilotSheetError(
      `unsupported original content-type for asset "${record.assetId}"`
    );
  }
  return escapeHtml(contentType);
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
// box at the row's size-matched width. Absent mount keeps the legacy
// intrinsic render. Malformed mounts fail closed: a silently misrendered
// mount is worse than no sheet.
const MOUNT_FITS = new Set(['cover', 'contain']);
const MOUNT_POSITION_PATTERN =
  /^(center|left|right|top|bottom|\d{1,3}%)( (center|left|right|top|bottom|\d{1,3}%))?$/;

export function parseMountCrop(geometry, slot) {
  const mount = geometry?.mount;
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
