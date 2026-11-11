import sharp from 'sharp';
import { digestBytes } from './manifest-digest';
import type { ExperienceSnapshotKey } from './snapshot-freshness';
/** Trusted bounded raster processing; no model or provider execution. */
export async function createVisualEvidence(
  original: Uint8Array,
  key: ExperienceSnapshotKey
) {
  if (original.byteLength > 20 * 1024 * 1024) throw Error('EVIDENCE_BUDGET');
  const bytes = await sharp(original, { limitInputPixels: 16000000 })
    .resize({
      width: 1440,
      height: 1800,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .png({ compressionLevel: 9 })
    .toBuffer();
  if (bytes.length > 2097152) throw Error('EVIDENCE_BUDGET');
  return {
    key,
    mime: 'image/png' as const,
    bytes,
    digest: digestBytes(bytes),
    originalDigest: digestBytes(original),
  };
}
