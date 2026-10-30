const ALLOWED_ASSET_PREFIX_PATTERN = /^core-assets\/(?:products|blog)\//;
// Lowercase-only to match the static-asset exclusion in apps/web/src/proxy.ts;
// uppercase extensions (.JPG, .PNG, etc.) would enter the proxy and be rewritten
// to /{customDomain}/cdn-image/... instead of reaching the root route handler.
const ALLOWED_ASSET_EXTENSION_PATTERN = /\.(?:avif|jpe?g|png|webp)$/;
const FORBIDDEN_PATH_PATTERN = /(?:^|\/)\.\.(?:\/|$)|\\|\0|%(?:2e|2f|5c)/i;
const ALLOWED_OPTION_KEYS = new Set([
  'fit',
  'format',
  'height',
  'quality',
  'width',
]);
const ALLOWED_FITS = new Set(['inside', 'cover'] as const);
const ALLOWED_FORMATS = new Set([
  'avif',
  'jpeg',
  'jpg',
  'png',
  'webp',
] as const);

export interface ParsedOgabasseyCdnImageProxyPath {
  assetPath: string;
  options: {
    fit: 'cover' | 'inside';
    format: 'avif' | 'jpeg' | 'jpg' | 'png' | 'webp';
    height?: number;
    quality: number;
    width: number;
  };
}

function parseBoundedInt(
  rawValue: string | undefined,
  min: number,
  max: number
): number | null {
  if (!rawValue || !/^\d+$/.test(rawValue)) {
    return null;
  }
  const parsed = Number(rawValue);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max
    ? parsed
    : null;
}

/**
 * Validates and parses decoded `/cdn-image/[...path]` segments without importing
 * Zod so client-side hero helpers and server-side route schemas share one
 * canonical allowlist while keeping `zod` out of the first-paint client bundle.
 */
export function parseOgabasseyCdnImageProxyPath(
  segments: readonly string[]
): ParsedOgabasseyCdnImageProxyPath | null {
  if (segments.length < 3 || segments.some((segment) => segment.length === 0)) {
    return null;
  }

  const [rawOptionsSegment, ...assetSegments] = segments;
  const rawOptionsMap = new Map<string, string>();
  for (const pair of rawOptionsSegment.split(',')) {
    const separatorIdx = pair.indexOf('=');
    if (separatorIdx <= 0) {
      return null;
    }
    const key = pair.slice(0, separatorIdx).trim().toLowerCase();
    const value = pair
      .slice(separatorIdx + 1)
      .trim()
      .toLowerCase();
    if (!ALLOWED_OPTION_KEYS.has(key) || rawOptionsMap.has(key)) {
      return null;
    }
    rawOptionsMap.set(key, value);
  }

  const rawFit = rawOptionsMap.get('fit') ?? 'inside';
  const rawFormat = rawOptionsMap.get('format');
  const rawHeight = rawOptionsMap.get('height');
  const quality = parseBoundedInt(rawOptionsMap.get('quality'), 1, 100);
  const width = parseBoundedInt(rawOptionsMap.get('width'), 16, 3840);
  const height =
    rawHeight !== undefined ? parseBoundedInt(rawHeight, 16, 3840) : undefined;

  if (
    !ALLOWED_FITS.has(rawFit as 'cover' | 'inside') ||
    !rawFormat ||
    !ALLOWED_FORMATS.has(
      rawFormat as ParsedOgabasseyCdnImageProxyPath['options']['format']
    ) ||
    quality === null ||
    width === null ||
    height === null
  ) {
    return null;
  }

  const assetPath = assetSegments.join('/');
  if (
    FORBIDDEN_PATH_PATTERN.test(assetPath) ||
    !ALLOWED_ASSET_PREFIX_PATTERN.test(assetPath) ||
    !ALLOWED_ASSET_EXTENSION_PATTERN.test(assetPath)
  ) {
    return null;
  }

  return {
    assetPath,
    options: {
      fit: rawFit as 'cover' | 'inside',
      format:
        rawFormat as ParsedOgabasseyCdnImageProxyPath['options']['format'],
      ...(height !== undefined ? { height } : {}),
      quality,
      width,
    },
  };
}
