import { createHash } from 'node:crypto';
import sharp from 'sharp';
export interface AssetReference {
  assetId: string;
  digest: string;
  mime: 'image/png' | 'font/woff2';
}
export interface OfflineAsset extends AssetReference {
  bytesBase64: string;
  width?: number;
  height?: number;
}
/** Trusted preparation only. The resolver accepts immutable IDs, never source URLs. */
export async function materializeAssets(
  references: AssetReference[],
  load: (assetId: string) => Promise<Uint8Array | null>
): Promise<OfflineAsset[]> {
  if (references.length > 32) throw new Error('Asset count budget');
  const seen = new Set<string>();
  let total = 0;
  const output: OfflineAsset[] = [];
  for (const ref of references) {
    if (
      !/^[a-z0-9-]{1,80}$/.test(ref.assetId) ||
      !/^[a-f0-9]{64}$/.test(ref.digest)
    )
      throw new Error('Invalid asset identity');
    if (seen.has(ref.assetId)) throw new Error('Duplicate asset');
    seen.add(ref.assetId);
    const loaded = await load(ref.assetId);
    if (!loaded) throw new Error('Missing offline asset');
    const bytes = Buffer.from(loaded);
    total += bytes.length;
    if (bytes.length > 2 * 1024 * 1024 || total > 4 * 1024 * 1024)
      throw new Error('Asset byte budget');
    if (createHash('sha256').update(bytes).digest('hex') !== ref.digest)
      throw new Error('Asset digest mismatch');
    let dimensions: { width?: number; height?: number } = {};
    if (ref.mime === 'image/png') {
      const image = sharp(bytes, { limitInputPixels: 4_000_000 });
      const metadata = await image.metadata();
      if (metadata.format !== 'png' || (metadata.pages ?? 1) !== 1)
        throw new Error('Unsupported image');
      await image.raw().toBuffer(); // Full bounded decode, not header-only admission.
      dimensions = { width: metadata.width, height: metadata.height };
    } else if (ref.mime === 'font/woff2') {
      if (
        bytes.length < 48 ||
        bytes.length > 1024 * 1024 ||
        bytes.toString('ascii', 0, 4) !== 'wOF2' ||
        bytes.readUInt32BE(8) !== bytes.length ||
        bytes.readUInt32BE(16) > 4 * 1024 * 1024
      )
        throw new Error('Invalid bounded WOFF2');
      // Actual font decoding is independently required in the isolated browser.
    } else throw new Error('Unsupported asset MIME');
    output.push({
      ...ref,
      ...dimensions,
      bytesBase64: bytes.toString('base64'),
    });
  }
  return output;
}
