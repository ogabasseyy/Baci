/**
 * Valid slug pattern: alphanumeric and hyphens, no file extensions.
 * Must start and end with alphanumeric character.
 */
export const VALID_SLUG_REGEX = /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/;

/**
 * Valid domain pattern: supports domains and subdomains (case-insensitive).
 * Allows alphanumeric labels separated by dots.
 */
export const VALID_DOMAIN_REGEX =
  /^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i;

const MAX_MERCHANT_IDENTIFIER_LENGTH = 254;

/**
 * Reserved paths that should NOT be treated as merchant slugs to avoid routing conflicts.
 */
export const RESERVED_PATHS = new Set([
  'cart',
  'checkout',
  'api',
  'auth',
  'login',
  'logout',
  'dashboard',
  'admin',
  'builder',
  'onboarding',
  'preview',
  'about',
  'contact',
  'blog',
  'pricing',
  'terms',
  'privacy',
  'faq',
  'features',
  'demo',
  'developers',
  'track',
  'invite',
  'reset-password',
  'template-preview',
  'orders',
  'saved',
  'addresses',
  'reviews',
  'help',
  'wallet',
  'repairs',
  'swap',
  'account',
  'delete-account',
  'images',
  'product',
  'staff',
  'signup',
  'forgot-password',
  'update-password',
  'verify',
]);

/**
 * Infrastructure subdomains that must not back a merchant storefront (they collide
 * with platform mail/app/CDN hosts). RESERVED_PATHS already covers the storefront
 * ROUTE words; these are the extra host-level names. This set MUST equal
 * RESERVED_SUBDOMAINS in lib/proxy/host.ts (subdomain->storefront routing) and the
 * infra names in the database's `is_reserved_merchant_slug()` (latest definition:
 * migration 20261120110000) — keep all three in sync.
 */
const INFRA_RESERVED_SUBDOMAINS = new Set([
  'www',
  'app',
  'api',
  'admin',
  'dashboard',
  'mail',
  'smtp',
  'assets',
  'static',
  'cdn',
  'status',
  'support',
  'help',
  'chat',
]);

/**
 * True when a slug may NOT be assigned to a NEW/renamed merchant because the proxy
 * and resolvers treat it as a platform route or infra host (it would serve "Store
 * Not Found"). This is the app-side mirror of the DB `is_reserved_merchant_slug()`
 * guard — used for a friendly, pre-signup rejection so an explicit reserved choice
 * can't orphan a just-created auth user.
 * @param slug The candidate slug (case-insensitive).
 */
export function isReservedMerchantSlug(slug: string): boolean {
  const normalized = slug.trim().toLowerCase();
  return (
    RESERVED_PATHS.has(normalized) || INFRA_RESERVED_SUBDOMAINS.has(normalized)
  );
}

/**
 * Checks if the identifier looks like a domain name (contains a dot).
 * @param identifier The string to check.
 * @returns True if it matches the domain regex.
 */
export function isDomainIdentifier(identifier: string): boolean {
  if (typeof identifier !== 'string') {
    return false;
  }

  if (
    !identifier.trim() ||
    identifier.length > MAX_MERCHANT_IDENTIFIER_LENGTH
  ) {
    return false;
  }

  // Reject common file extensions to prevent filenames being treated as domains
  if (/\.(ico|json|png|jpg|jpeg|svg|css|js|map|txt|xml)$/i.test(identifier)) {
    return false;
  }

  return (
    identifier.includes('.') &&
    VALID_DOMAIN_REGEX.test(identifier.toLowerCase())
  );
}

/**
 * Checks if the string has valid merchant-slug SHAPE (format + length), IGNORING
 * whether it is a reserved path. A retired slug that later became reserved (e.g. a
 * store that used 'staff' before 'staff' was reserved, then renamed) is still a
 * legitimate alias key — callers that resolve aliases must recognize its shape
 * even though it can no longer be a live slug.
 * @param slug The string to check.
 * @returns True if it is well-formed and not a domain/file-extension.
 */
export function isSlugShapedIdentifier(slug: string): boolean {
  return (
    typeof slug === 'string' &&
    !!slug.trim() &&
    slug.length <= MAX_MERCHANT_IDENTIFIER_LENGTH &&
    !slug.includes('.') && // No file extensions
    VALID_SLUG_REGEX.test(slug.toLowerCase())
  );
}

/**
 * Checks if the string is a valid merchant slug.
 * @param slug The string to check.
 * @returns True if valid format and not a reserved path.
 */
export function isValidMerchantSlug(slug: string): boolean {
  return (
    isSlugShapedIdentifier(slug) && // format + length, not a domain
    !RESERVED_PATHS.has(slug.toLowerCase()) // Not a reserved path
  );
}

/**
 * Validates if the string is either a valid slug OR a valid domain.
 * @param identifier The string to check.
 * @returns True if it matches either format.
 */
export function isValidMerchantIdentifier(identifier: string): boolean {
  return isValidMerchantSlug(identifier) || isDomainIdentifier(identifier);
}
