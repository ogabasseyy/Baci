import type { LayoutCaptureManifest } from './ogabassey-layout-manifest-schema';
import { readArtifactFile } from './ogabassey-layout-safe-file';

export async function loadAssetBodies(
  captureDir: string,
  prebuiltDir: string,
  manifest: LayoutCaptureManifest
) {
  const entries = await Promise.all(
    manifest.assets.map(async (asset) => {
      const pathname = new URL(asset.url, 'http://artifact.invalid').pathname;
      if (!pathname.startsWith('/_next/static/')) {
        throw new Error(`Unsupported prebuilt dependency ${asset.url}`);
      }
      const captured = await readArtifactFile(captureDir, asset.path);
      let built: Buffer;
      try {
        built = await readArtifactFile(prebuiltDir, pathname.slice(1));
      } catch (error) {
        if (
          error instanceof Error &&
          'code' in error &&
          error.code === 'ENOENT'
        ) {
          throw new Error(`Prebuilt dependency missing: ${asset.url}`, {
            cause: error,
          });
        }
        throw error;
      }
      if (!captured.equals(built)) {
        throw new Error(
          `Prebuilt dependency ${asset.url} differs from capture`
        );
      }
      return [asset.url, captured.toString('utf8')] as const;
    })
  );
  return new Map(entries);
}
