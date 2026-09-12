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
export const OGABASSEY_TWITTER_HANDLE = '@ogabasseyy';

export const OGABASSEY_MERCHANT_ID = '6b5cb8a4-5575-456c-b936-8cdfae30db74';
const OGABASSEY_FAVICON_BASE_PATH = `merchants/${OGABASSEY_MERCHANT_ID}/favicon`;

export const OGABASSEY_FAVICON_URL = `${DEFAULT_MEDIA_CDN_ORIGIN}/media/${OGABASSEY_FAVICON_BASE_PATH}/favicon-32.png`;
export const OGABASSEY_APPLE_TOUCH_ICON_URL = `${DEFAULT_MEDIA_CDN_ORIGIN}/media/${OGABASSEY_FAVICON_BASE_PATH}/apple-touch-icon.png`;
