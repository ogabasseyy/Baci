import { isTrustedBlogMediaTransformUrl } from '@/lib/is-trusted-blog-media-transform-url';

const MIN_TRANSFORM_DIMENSION = 16;
const MAX_TRANSFORM_DIMENSION = 3840;
const TRANSFORMABLE_SOURCE_PATTERN = /\.(?:avif|jpe?g|png|webp)$/iu;
const ENCODED_TRAVERSAL_PATTERN = /%(?:2e|2f|5c)/iu;
const PARENT_TRAVERSAL_SEGMENT_PATTERN = /(?:^|\/)\.\.(?:\/|$)/u;

function getTransformDimension(value: string | undefined) {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return undefined;
  return Math.max(
    MIN_TRANSFORM_DIMENSION,
    Math.min(MAX_TRANSFORM_DIMENSION, parsed)
  );
}

/** Parses fixed output metadata only from configured blog transformers. */
export function getTrustedBlogMediaTransformProjection(url: string):
  | {
      fit: 'cover' | 'inside';
      height?: number;
      type?: `image/${string}`;
      width?: number;
    }
  | undefined {
  try {
    if (!isTrustedBlogMediaTransformUrl(url)) {
      return undefined;
    }
    const parsedUrl = new URL(url);
    const transformPath = parsedUrl.pathname.match(/^\/image\/([^/]+)\/(.+)$/u);
    const options = transformPath?.[1];
    const encodedSourcePath = transformPath?.[2];
    if (!options || !encodedSourcePath) {
      return undefined;
    }
    const sourcePath = decodeURIComponent(encodedSourcePath);
    if (
      sourcePath.includes('\0') ||
      sourcePath.includes('\\') ||
      ENCODED_TRAVERSAL_PATTERN.test(sourcePath) ||
      PARENT_TRAVERSAL_SEGMENT_PATTERN.test(sourcePath) ||
      !TRANSFORMABLE_SOURCE_PATTERN.test(sourcePath)
    ) {
      return undefined;
    }

    const entries = new Map(
      options.split(',').flatMap((token) => {
        const [rawName, rawValue] = token.split('=', 2);
        return rawName && rawValue !== undefined
          ? [[rawName.trim().toLowerCase(), rawValue.trim().toLowerCase()]]
          : [];
      })
    );
    const format = entries.get('format') ?? entries.get('f') ?? 'auto';
    const type =
      format === 'jpg' || format === 'jpeg'
        ? 'image/jpeg'
        : format === 'png'
          ? 'image/png'
          : format === 'webp'
            ? 'image/webp'
            : format === 'avif'
              ? 'image/avif'
              : undefined;
    const width = getTransformDimension(
      entries.get('width') || entries.get('w')
    );
    const height = getTransformDimension(
      entries.get('height') || entries.get('h')
    );

    return {
      fit:
        entries.get('fit') === 'cover'
          ? ('cover' as const)
          : ('inside' as const),
      ...(type ? { type } : {}),
      ...(width ? { width } : {}),
      ...(height ? { height } : {}),
    };
  } catch {
    return undefined;
  }
}
