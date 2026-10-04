import { STOREFRONT_AGENT_ROUTES } from '@/config/storefront-agent-routes';
import { STOREFRONT_FEED_ROUTES } from '@/config/storefront-feed-routes';
import { POSTHOG_RELAY_PATH } from '@/lib/proxy/posthog-relay';

export const PUBLIC_MACHINE_READABLE_PATHS = new Set<string>([
  ...Object.values(STOREFRONT_AGENT_ROUTES),
  ...Object.values(STOREFRONT_FEED_ROUTES),
]);

export const STATIC_FILES_REGEX =
  /\.(jpg|jpeg|png|gif|svg|ico|webp|avif|woff|woff2|ttf|eot|css|js|json)$/;

export const IMAGE_FILES_REGEX =
  /\.(jpg|jpeg|png|gif|svg|ico|webp|avif|woff|woff2|ttf|eot)$/;

export const BOT_USER_AGENT_REGEX =
  /bot|crawler|spider|crawling|googlebot|bingbot|slurp|duckduckbot|baiduspider|yandexbot|facebookexternalhit|twitterbot|rogerbot|linkedinbot|embedly|quora link preview|showyoubot|outbrain|pinterest|slackbot|vkShare|W3C_Validator/i;

export const NESTED_PRODUCT_SUBROUTE_EXCLUSIONS = new Set([
  'best-under',
  'compare',
]);

export const CATEGORY_LISTING_HUB_SEGMENTS = new Set(['compare']);

export const BLOG_STATUS_PREFLIGHT_EXCLUDED_SLUGS = new Set([
  'feed.xml',
  'news-sitemap.xml',
  'opengraph-image',
  'rss.xml',
  'sitemap.xml',
  'twitter-image',
]);

export const DRAFT_MODE_COOKIE_NAMES = [
  '__prerender_bypass',
  '__next_preview_data',
];

export const STOREFRONT_METADATA_CACHE_NON_HTML_EXTENSIONS_REGEX =
  /\.(?:json|jsonl|md|txt|webmanifest|xml)$/i;

export const STOREFRONT_METADATA_CACHE_NON_HTML_SEGMENTS = new Set([
  '_next',
  'api',
]);

export const STOREFRONT_METADATA_CACHE_NON_HTML_ROUTE_SEGMENTS = new Set([
  'apple-icon',
  'icon',
  'opengraph-image',
  'twitter-image',
]);

export const STOREFRONT_METADATA_CACHE_NON_SEO_SEGMENTS = new Set([
  'account',
  'cart',
  'checkout',
  'delete-account',
  'my-account',
  'order-success',
  'receipts',
  'track-order',
  'wallet',
  'wishlist',
]);

export const PLATFORM_ROOT_ROUTE_SEGMENTS = new Set([
  '_next',
  'about',
  'admin',
  'api',
  'auth',
  'blog',
  'builder',
  'cart',
  'checkout',
  'contact',
  'debug-auth',
  'delete-account',
  'demo',
  'developers',
  'features',
  'favicon.ico',
  'feeds',
  'forgot-password',
  'invite',
  'login',
  'manifest.webmanifest',
  'onboarding',
  'pricing',
  'privacy',
  'products',
  'reset-password',
  'robots.txt',
  'signup',
  'sitemap.xml',
  'staff',
  'template-preview',
  'terms',
  'track',
  'update-password',
  'verify',
]);

export const BLOG_PATH_REGEX =
  /^(?:\/(?!(?:api|dashboard|admin|auth|login|onboarding|builder|reset-password|checkout|cart|staff|invite|actions|about|contact|pricing|privacy|terms|features|developers|demo|debug-auth|template-preview|track|_next|sitemap\.xml|robots\.txt|manifest\.webmanifest|favicon\.ico)(?:\/|$))[^/]+)?\/blog(?:\/.*)?$/;

export const MAIN_APP_ROUTES = [
  '/dashboard',
  // '/api', // Allow API access on subdomains (controlled by middleware)
  '/auth',
  '/login',
  // Platform auth/staff pages under app/(auth)/ + the staff-invite flow. Like
  // '/login', these live only on the platform (never a storefront), so on a
  // subdomain they must redirect to usebaci.com/<route> and be EXCLUDED from the
  // retired-slug storefront redirect — otherwise old.usebaci.com/signup would be
  // sent to the current store's /signup (404) after a rename.
  '/signup',
  '/forgot-password',
  '/update-password',
  '/verify',
  '/staff',
  '/onboarding',
  '/builder',
  '/reset-password',
  POSTHOG_RELAY_PATH,
  '/_next',
  '/robots.txt',
  '/manifest.webmanifest',
];

export const ROOT_DOMAIN_ONLY_MAIN_APP_ROUTES = ['/checkout'];

export const CASE_PRESERVING_PREFIXES = [
  '/api',
  '/track',
  '/_next',
  '/dashboard',
  '/auth',
  '/login',
  '/onboarding',
  '/builder',
  '/reset-password',
  POSTHOG_RELAY_PATH,
  '/favicon.ico',
  '/robots.txt',
  '/sitemap.xml',
  '/manifest.webmanifest',
];

export const CACHEABLE_PUBLIC_STOREFRONT_FIRST_SEGMENTS = new Set([
  'about',
  'blog',
  'contact',
  'faq',
  'privacy',
  'privacy-policy',
  'products',
  'returns',
  'shipping',
  'terms',
  'terms-and-conditions',
  'terms-of-service',
  'warranty',
]);
