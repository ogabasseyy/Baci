const MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  avif: 'image/avif',
  gif: 'image/gif',
  svg: 'image/svg+xml',
};

const CDN_FORMAT_TRANSFORM_REGEX =
  /(?:^|[/,;])(?:format|f)=([a-z0-9]+)(?=$|[/,;])/i;

/**
 * Derives an accurate IANA media type from an image URL for RSS enclosures.
 *
 * Honors CDN format transforms (e.g. `/cdn-cgi/image/format=webp/...jpg` or
 * `?format=avif`) before falling back to the pathname extension. Returns
 * `undefined` when the served media type is indeterminate (such as
 * `format=auto`, conflicting path/query formats, extension-less URLs, or
 * unknown extensions) so callers do not emit mismatched `<enclosure type="...">`
 * attributes.
 */
export function getImageMimeType(url: string): string | undefined {
  try {
    const parsedUrl = new URL(url);
    const pathname = parsedUrl.pathname.toLowerCase();
    const queryFormat = (
      parsedUrl.searchParams.get('format') ??
      parsedUrl.searchParams.get('f') ??
      ''
    ).toLowerCase();
    const pathFormat = (
      pathname.match(CDN_FORMAT_TRANSFORM_REGEX)?.[1] ?? ''
    ).toLowerCase();
    if (pathFormat && queryFormat && pathFormat !== queryFormat) {
      return undefined;
    }
    const transformFormat = pathFormat || queryFormat;

    if (transformFormat) {
      if (transformFormat === 'auto') {
        return undefined;
      }
      return Object.hasOwn(MIME_BY_EXTENSION, transformFormat)
        ? MIME_BY_EXTENSION[transformFormat]
        : undefined;
    }

    const lastDotIndex = pathname.lastIndexOf('.');
    if (lastDotIndex === -1) {
      return undefined;
    }
    const ext = pathname.slice(lastDotIndex + 1);
    return Object.hasOwn(MIME_BY_EXTENSION, ext)
      ? MIME_BY_EXTENSION[ext]
      : undefined;
  } catch {
    return undefined;
  }
}
