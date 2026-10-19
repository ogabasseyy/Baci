import { DEFAULT_BLOG_MEDIA_CDN_ORIGIN } from '@/config/cdn';

/** Identifies URLs routed through an approved blog media transformer. */
export function isTrustedBlogMediaTransformUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    const trustedOrigins = [
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

    return (
      url.protocol === 'https:' &&
      trustedOrigins.includes(url.origin) &&
      url.pathname.startsWith('/image/')
    );
  } catch {
    return false;
  }
}
