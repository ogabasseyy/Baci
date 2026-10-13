import { DEFAULT_BLOG_MEDIA_CDN_ORIGIN } from '@/config/cdn';

const LANDSCAPE_VARIANT_PATH_PATTERN =
  /(?:^|[-/])landscape_16x9\.(?:avif|jpe?g|png|webp)$/iu;
const IMMUTABLE_BLOG_IMAGE_PATH_PREFIXES = [
  '/core-assets/blog/',
  '/media/',
  '/storage/v1/object/public/media/',
] as const;

/** Allows immutable landscape variants only from configured media storage. */
export function isTrustedImmutableBlogLandscapeVariantUrl(
  raw: string
): boolean {
  try {
    const url = new URL(raw);
    const transformerOrigins = [
      process.env.NEXT_PUBLIC_BLOG_MEDIA_CDN_ORIGIN,
      DEFAULT_BLOG_MEDIA_CDN_ORIGIN,
    ].flatMap((value) => {
      if (!value) return [];
      try {
        return [new URL(value).origin];
      } catch {
        return [];
      }
    });
    const trustedOrigins = [
      ...transformerOrigins,
      process.env.NEXT_PUBLIC_SUPABASE_URL,
    ].flatMap((value) => {
      if (!value) return [];
      try {
        return [new URL(value).origin];
      } catch {
        return [];
      }
    });
    if (url.protocol !== 'https:' || !trustedOrigins.includes(url.origin)) {
      return false;
    }

    const decodedPath = decodeURIComponent(url.pathname);
    const sourcePath = transformerOrigins.includes(url.origin)
      ? (decodedPath.match(/^\/image\/[^/]+(\/.+)$/u)?.[1] ?? decodedPath)
      : decodedPath;
    return (
      IMMUTABLE_BLOG_IMAGE_PATH_PREFIXES.some((prefix) =>
        sourcePath.startsWith(prefix)
      ) && LANDSCAPE_VARIANT_PATH_PATTERN.test(sourcePath)
    );
  } catch {
    return false;
  }
}
