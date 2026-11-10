// The Next config loader needs a path relative to this file for shared source.
import { DEFAULT_MEDIA_CDN_ORIGIN } from '../../../../packages/shared/src/constants/media-cdn';

export { DEFAULT_MEDIA_CDN_ORIGIN };
export const DEFAULT_BLOG_MEDIA_CDN_ORIGIN = DEFAULT_MEDIA_CDN_ORIGIN;

/**
 * Default next/image `quality` the custom loader (`lib/image-loader.ts`)
 * applies when a caller renders an image without an explicit `quality` prop.
 * Shared so the CDN transform prewarm (`lib/ogabassey-image-prewarm.ts`) can
 * prime the exact width×quality variants real requests resolve to instead of
 * duplicating the literal.
 */
export const DEFAULT_IMAGE_QUALITY = 75;
