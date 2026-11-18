const CANONICAL_TECNO_SPONSORED_BLOG_URL =
  'https://ogabassey.com/blog/tecno-camon-slim-iphone-instant-transfer-sponsored';

/**
 * Gates TECNO sponsored-post CTA tracking to Ogabassey's canonical custom-domain
 * URL (`https://ogabassey.com`) so preview/subdomain traffic does not skew live
 * campaign telemetry, while normalizing trailing slashes and origin casing.
 */
export function isTecnoSponsoredBlogUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    const normalizedPath = parsed.pathname.replace(/\/+$/, '') || '/';
    return (
      `${parsed.origin.toLowerCase()}${normalizedPath}` ===
      CANONICAL_TECNO_SPONSORED_BLOG_URL
    );
  } catch {
    return false;
  }
}
