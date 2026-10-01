import { DEFAULT_MEDIA_CDN_ORIGIN } from '@/config/cdn';

export const OGABASSEY_DOMAIN = 'ogabassey.com';
export const OGABASSEY_URL = `https://${OGABASSEY_DOMAIN}`;
export const OGABASSEY_HOME_URL = `${OGABASSEY_URL}/`;
export const OGABASSEY_TITLE = 'OgaBassey - Official Online Store';
export const OGABASSEY_DESCRIPTION =
  'Shop OgaBassey for phones, laptops, gaming consoles, accessories, subscriptions, airtime, data, and flexible payment options in Nigeria.';
/** First-viewport home extract. Keep this shorter than the H1 box. */
export const OGABASSEY_HOME_LCP_SUPPORT =
  'Shop phones, laptops, consoles and gadgets in Nigeria.';
export const OGABASSEY_SOCIAL_IMAGE_URL = `${OGABASSEY_URL}/template-previews/ogabassey-v2.png`;
/**
 * Committed slide-0 hero image (raw CDN URL, before transform params) for the
 * earliest preload slot. Source: the launch-products feed behind
 * `resolveOgabasseyHomeHeroShell` — refresh this when hero merchandising
 * rotates slide-0. Safety, in order: the projection builder allowlists the
 * CDN origin (a bad value renders nothing); this URL NEVER renders UI (the
 * publication guard owns all visible output); worst case of staleness is an
 * unused preload fetch, deduped away when it still matches.
 */
export const OGABASSEY_HOME_COMMITTED_HERO_IMAGE_URL =
  'https://cdn.ogabassey.com/core-assets/products/premium-laptops/dell-alienware-m18-r2.jpg';
export const OGABASSEY_TWITTER_HANDLE = '@ogabasseyy';

export const OGABASSEY_MERCHANT_ID = '6b5cb8a4-5575-456c-b936-8cdfae30db74';
const OGABASSEY_FAVICON_BASE_PATH = `merchants/${OGABASSEY_MERCHANT_ID}/favicon`;

export const OGABASSEY_FAVICON_URL = `${DEFAULT_MEDIA_CDN_ORIGIN}/media/${OGABASSEY_FAVICON_BASE_PATH}/favicon-32.png`;
export const OGABASSEY_APPLE_TOUCH_ICON_URL = `${DEFAULT_MEDIA_CDN_ORIGIN}/media/${OGABASSEY_FAVICON_BASE_PATH}/apple-touch-icon.png`;
