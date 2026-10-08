import sharp from 'sharp';
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

// Decoded container format of hash-verified snapshot bytes, for bindings
// with no accepted manifest to name the format. Unaccepted bindings still
// stage their verified original (so the store renders the real control
// instead of a not-optimized row) but the filename must come from the
// bytes themselves, never from an unaccepted claim.
export async function snapshotFormat(snapshot: Buffer): Promise<string> {
  const metadata = await sharp(snapshot).metadata();
  return normalizeFormat(metadata).toLowerCase();
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
  const metadata = await sharp(snapshot).metadata();
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
