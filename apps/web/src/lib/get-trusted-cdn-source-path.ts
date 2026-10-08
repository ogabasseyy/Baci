import { TRUSTED_BLOG_IMAGE_ORIGINS } from './trusted-blog-image-origins';

// Decoded storage path behind a trusted CDN image URL, with one
// leading transform segment (`/image/<params>/...`) stripped so
// transformed and plain URLs compare by the same source object.
export function getTrustedCdnSourcePath(raw: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (
    parsed.protocol !== 'https:' ||
    !TRUSTED_BLOG_IMAGE_ORIGINS.has(parsed.origin)
  ) {
    return null;
  }
  let path = parsed.pathname;
  if (path.startsWith('/image/')) {
    const rest = path.slice('/image/'.length);
    const slash = rest.indexOf('/');
    // An empty transform segment (`/image//...`) is malformed: the
    // social-image projection treats it as unusable, so no source
    // path is decoded from it.
    if (slash <= 0) return null;
    path = rest.slice(slash);
  }
  try {
    return decodeURIComponent(path);
  } catch {
    return null;
  }
}
