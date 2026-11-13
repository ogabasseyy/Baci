const DETERMINISTIC_FORMAT_BY_EXT: Readonly<Record<string, string>> = {
  jpg: 'jpeg',
  jpeg: 'jpeg',
  png: 'png',
  webp: 'webp',
  // Cloudflare Image Resizing may fall back from AVIF to WebP/JPEG when encoding
  // exceeds time budgets; pin to WebP for deterministic enclosure MIME types.
  avif: 'webp',
  gif: 'gif',
};

/**
 * Replaces `format=auto` / `f=auto` directives in CDN image URLs with a
 * deterministic output format derived from the pathname extension so RSS
 * `<enclosure type="...">` declarations match the delivered bytes.
 */
export function pinDeterministicFeedImageFormat(url: string): string {
  try {
    const parsedUrl = new URL(url);
    const lowerPath = parsedUrl.pathname.toLowerCase();
    const lastDot = lowerPath.lastIndexOf('.');
    if (lastDot === -1) {
      return url;
    }
    const ext = lowerPath.slice(lastDot + 1);
    const targetFormat = Object.hasOwn(DETERMINISTIC_FORMAT_BY_EXT, ext)
      ? DETERMINISTIC_FORMAT_BY_EXT[ext]
      : undefined;
    if (!targetFormat) {
      return url;
    }

    if (parsedUrl.searchParams.get('format')?.toLowerCase() === 'auto') {
      parsedUrl.searchParams.set('format', targetFormat);
    }
    if (parsedUrl.searchParams.get('f')?.toLowerCase() === 'auto') {
      parsedUrl.searchParams.set('f', targetFormat);
    }
    parsedUrl.pathname = parsedUrl.pathname.replace(
      /(^|[/,;])(format|f)=auto(?=$|[/,;])/gi,
      `$1$2=${targetFormat}`
    );
    return parsedUrl.toString();
  } catch {
    return url;
  }
}
