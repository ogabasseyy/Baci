import { createHash } from 'node:crypto';
import type { WorkerStorefrontManifest } from '../schemas/worker-manifest';

export function sha256Hex(chunks: readonly string[]): string {
  const hash = createHash('sha256');
  for (const chunk of chunks) hash.update(chunk).update('\0');
  return hash.digest('hex');
}

export function computeManifestSourceDigest(
  manifest: WorkerStorefrontManifest
): string {
  const cmpStr = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  const canonicalManifest = {
    format: manifest.format,
    mode: manifest.mode,
    merchantSlug: manifest.merchantSlug,
    entry: manifest.entry,
    routes: manifest.routes.map((r) => ({ path: r.path, view: r.view })),
    packages: [...manifest.packages].sort((a, b) => cmpStr(a.name, b.name)),
    assets: [...manifest.assets].sort((a, b) => cmpStr(a.assetId, b.assetId)),
    themeTokens: {
      primary: manifest.themeTokens.primary,
      secondary: manifest.themeTokens.secondary,
      accent: manifest.themeTokens.accent,
    },
    cspAllowlist: {
      scriptOrigins: [...manifest.cspAllowlist.scriptOrigins].sort(),
      connectOrigins: [...manifest.cspAllowlist.connectOrigins].sort(),
      imgOrigins: [...manifest.cspAllowlist.imgOrigins].sort(),
    },
    ...(manifest.hostOrigin ? { hostOrigin: manifest.hostOrigin } : {}),
    ...(manifest.previewOrigin
      ? { previewOrigin: manifest.previewOrigin }
      : {}),
    files: [...manifest.files]
      .sort((a, b) => cmpStr(a.path, b.path))
      .map((f) => ({ path: f.path, content: f.content })),
  };
  return sha256Hex([JSON.stringify(canonicalManifest)]);
}
