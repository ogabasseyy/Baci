import sharp from 'sharp';
import type { PilotBindingStatus } from './lab-index';

type SourceFacts = NonNullable<PilotBindingStatus['source']>;

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
  const decodedFormat = (metadata.format ?? '').toLowerCase();
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
