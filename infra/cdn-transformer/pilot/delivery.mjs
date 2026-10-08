// Never-larger delivery guard (recipe r2). Pure per-rung decision: compare
// generated-rung BODY bytes against validated source BODY bytes and choose
// the delivery for the manifest/resolver contract.
//
// - rung <= source: `generated` (derivative kept, including the equality
//   boundary — equal is not larger).
// - rung > source with a branch-compatible original (source codec equals the
//   rung's typed branch, avif or webp): `original-passthrough`. The delivery
//   carries the source bytes, dimensions, and hash; the width descriptor is
//   the TRUE source width (an 800w original reused for a 768 request says
//   800w). Geometry, crop, alpha, orientation, MIME, and hashes are preserved
//   because the delivered bytes are the validated source bytes.
// - rung > source with an incompatible original (jpeg/png source):
//   `generated-over-source` — an EXPLICIT OVER-SOURCE EXCEPTION, not a
//   capped delivery. The generated tier is kept (bytes stay > source)
//   because an unsupported codec is never forced into a typed branch
//   solely to meet the cap. Consumers must never treat this disposition
//   as capped; validators require its bytes to EXCEED the source.
//
// Pass-through bytes are committed as validated copies inside the generation
// directory (see generate.mjs), so generations stay self-contained, hash
// bound, tenant bound, and immutably cacheable, and hint/render agreement
// flows through the same tier machinery. Units are body bytes on both sides;
// wire transfer sizes must never enter this comparison.
import { DELIVERY_GUARD } from './constants.mjs';

export class PilotDeliveryError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.name = 'PilotDeliveryError';
  }
}

function assertPositiveBodyBytes(value, what) {
  if (!Number.isInteger(value) || value < 1) {
    throw new PilotDeliveryError(
      'bad-request',
      `${what} needs positive body bytes`
    );
  }
}

function assertNormalizedSource(source) {
  if (
    !source ||
    typeof source.format !== 'string' ||
    !DELIVERY_GUARD.knownSourceFormats.includes(source.format)
  ) {
    throw new PilotDeliveryError(
      'bad-request',
      'source needs a normalized source format'
    );
  }
  assertPositiveBodyBytes(source.bytes, 'source');
  for (const axis of ['orientedWidth', 'orientedHeight']) {
    if (!Number.isInteger(source[axis]) || source[axis] < 1) {
      throw new PilotDeliveryError(
        'bad-request',
        `source needs a positive ${axis}`
      );
    }
  }
  if (!/^[0-9a-f]{64}$/.test(source.sha256 ?? '')) {
    throw new PilotDeliveryError('bad-request', 'source needs a sha256');
  }
}

function assertRung(rung) {
  if (!rung || (rung.format !== 'avif' && rung.format !== 'webp')) {
    throw new PilotDeliveryError('bad-request', 'rung needs a typed format');
  }
  assertPositiveBodyBytes(rung.bytes, 'rung');
}

// Per-rung/per-format guard, NOT merchant-wide: an incompatible source
// codec (e.g. AVIF original on a WebP rung) yields generated-over-source
// — bytes stay larger than the source for that rung. Never present lab
// savings as merchant-wide while over-source dispositions exist.
export function decideTierDelivery({ rung, source }) {
  assertRung(rung);
  assertNormalizedSource(source);
  if (rung.bytes <= source.bytes) {
    return { ...rung, delivery: 'generated' };
  }
  const compatible =
    DELIVERY_GUARD.passthroughFormats.includes(source.format) &&
    source.format === rung.format;
  if (!compatible) {
    return { ...rung, delivery: 'generated-over-source' };
  }
  return {
    ...rung,
    actualWidth: source.orientedWidth,
    bytes: source.bytes,
    delivery: 'original-passthrough',
    height: source.orientedHeight,
    quality: null,
    sha256: source.sha256,
    width: source.orientedWidth,
  };
}

export function applyDeliveryGuard({ source, tiers }) {
  assertNormalizedSource(source);
  if (!Array.isArray(tiers)) {
    throw new PilotDeliveryError('bad-request', 'tiers must be an array');
  }
  return tiers.map((rung) => decideTierDelivery({ rung, source }));
}
