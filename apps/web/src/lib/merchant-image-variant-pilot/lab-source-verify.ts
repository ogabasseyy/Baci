import sharp from 'sharp';
import {
  PILOT_MAX_AXIS_PIXELS,
  PILOT_MAX_DECODE_CHANNELS,
  PILOT_MAX_DECODED_PIXELS,
  PILOT_SHARP_LIMITS,
} from '@/schemas/merchant-image-variant-pilot';
import type { PilotBindingStatus } from './lab-index';

type SourceFacts = NonNullable<PilotBindingStatus['source']>;

// Mirror of normalizeFormat in
// infra/cdn-transformer/pilot/encode-worker-formats.mjs: Sharp/libvips
// reports the shared HEIF container as `heif` for both input and output
// bytes. Only AV1-coded stills are AVIF: HEVC-coded HEIC stills and
// unknown compressions stay `heif` so the format gates reject them.
function normalizeFormat(metadata: {
  compression?: string;
  format?: string;
}): string {
  if (metadata.format === 'heif' && metadata.compression === 'av1') {
    return 'avif';
  }
  return metadata.format ?? '';
}

// Generator-accepted still-image inputs (mirrors ACCEPTED_INPUT_FORMATS
// in infra/cdn-transformer/pilot/constants.mjs; TS cannot import infra).
// The staged-original extension map also knows gif/svg, but those are
// never generator inputs: staging them would publish active or animated
// merchant bytes the pilot cannot vouch for.
const STAGEABLE_SNAPSHOT_FORMATS = ['avif', 'jpeg', 'png', 'webp'];

// Decoded container format of hash-verified snapshot bytes, for bindings
// with no accepted manifest to name the format. Unaccepted bindings still
// stage their verified original (so the store renders the real control
// instead of a not-optimized row) but the filename must come from the
// bytes themselves, never from an unaccepted claim — and only after the
// same gates the accepted path enforces. Metadata alone would stage an
// active SVG, an animated GIF, or a header-readable truncated raster
// under the same-origin public tree while every hash check still passes.
export async function snapshotFormat(
  snapshot: Buffer,
  label: string
): Promise<string> {
  const metadata = await sharp(snapshot, { ...PILOT_SHARP_LIMITS }).metadata();
  if ((metadata.pages ?? 1) > 1) {
    throw new Error(
      `merchant image pilot: snapshot for "${label}" is animated but the pilot stages stills only`
    );
  }
  // The generator's per-axis ceiling (rotation only swaps axes, so the
  // raw metadata pair decides like assertAcceptedMetadata): a fully
  // decodable 20,000x1 strip passes the 40M-pixel Sharp limit but must
  // still refuse — staging it would publish an original the generator
  // rejects on sight.
  if (
    (metadata.width ?? 0) > PILOT_MAX_AXIS_PIXELS ||
    (metadata.height ?? 0) > PILOT_MAX_AXIS_PIXELS
  ) {
    throw new Error(
      `merchant image pilot: snapshot for "${label}" is ${metadata.width}x${metadata.height} but axes are capped at ${PILOT_MAX_AXIS_PIXELS}`
    );
  }
  // metadata() is header-only: force a full pixel decode (bounded by the
  // same generator limits) so a truncated payload fails here instead of
  // staging bytes browsers cannot render.
  try {
    await sharp(snapshot, { ...PILOT_SHARP_LIMITS }).stats();
  } catch {
    throw new Error(
      `merchant image pilot: snapshot for "${label}" does not fully decode`
    );
  }
  const decodedFormat = normalizeFormat(metadata).toLowerCase();
  if (!STAGEABLE_SNAPSHOT_FORMATS.includes(decodedFormat)) {
    throw new Error(
      `merchant image pilot: snapshot for "${label}" decodes as "${decodedFormat || 'unknown'}" but only ${STAGEABLE_SNAPSHOT_FORMATS.join(', ')} originals stage`
    );
  }
  return decodedFormat;
}

// Decodes the hash-verified snapshot and proves the accepted manifest's
// source facts against the real bytes: a manifest whose hash matches but
// whose claimed format or dimensions describe a different file is
// rejected before anything downstream trusts those facts. Dimensions are
// EXIF-oriented (orientations 5-8 transpose the stored axes), matching
// the encoder's own recording.
export async function assertSnapshotMatchesSource(
  snapshot: Buffer,
  source: SourceFacts,
  label: string
): Promise<void> {
  // Same decoder limits as the generator: a manifest whose hash matches
  // but whose bytes are animated, over-channeled, or beyond the decoded
  // pixel ceiling must fail before anything certifies those facts.
  const metadata = await sharp(snapshot, { ...PILOT_SHARP_LIMITS }).metadata();
  if ((metadata.pages ?? 1) > 1) {
    throw new Error(
      `merchant image pilot: snapshot for "${label}" is animated but the pilot certifies stills only`
    );
  }
  if (
    metadata.channels !== undefined &&
    metadata.channels > PILOT_MAX_DECODE_CHANNELS
  ) {
    throw new Error(
      `merchant image pilot: snapshot for "${label}" has too many channels`
    );
  }
  // metadata() is header-only: force a full pixel decode (bounded by the
  // same generator limits) so a readable header with a truncated payload
  // fails here instead of certifying as the manifest source facts.
  try {
    await sharp(snapshot, { ...PILOT_SHARP_LIMITS }).stats();
  } catch {
    throw new Error(
      `merchant image pilot: snapshot for "${label}" does not fully decode`
    );
  }
  const decodedFormat = normalizeFormat(metadata).toLowerCase();
  if (decodedFormat !== source.format.toLowerCase()) {
    throw new Error(
      `merchant image pilot: snapshot for "${label}" decodes as "${decodedFormat || 'unknown'}" but the accepted manifest claims "${source.format}"`
    );
  }
  const orientation = metadata.orientation ?? 1;
  const swapAxes = orientation >= 5 && orientation <= 8;
  const width = swapAxes ? metadata.height : metadata.width;
  const height = swapAxes ? metadata.width : metadata.height;
  if (typeof width !== 'number' || typeof height !== 'number') {
    throw new Error(
      `merchant image pilot: snapshot for "${label}" has no decodable dimensions`
    );
  }
  if (width * height > PILOT_MAX_DECODED_PIXELS) {
    throw new Error(
      `merchant image pilot: snapshot for "${label}" decodes to ${width}x${height}, beyond the generator pixel limit`
    );
  }
  if (
    snapshot.length !== source.bytes ||
    width !== source.orientedWidth ||
    height !== source.orientedHeight
  ) {
    throw new Error(
      `merchant image pilot: snapshot for "${label}" is ${width}x${height} (${snapshot.length} B) but the accepted manifest claims ${source.orientedWidth}x${source.orientedHeight} (${source.bytes} B)`
    );
  }
}
