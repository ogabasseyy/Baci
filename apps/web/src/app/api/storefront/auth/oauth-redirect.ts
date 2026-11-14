import { getAppUrl, getRootDomain } from '@/env';

const HOSTNAME_PATTERN =
  /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;

type StorefrontOAuthMerchant = {
  custom_domain?: string | null;
  slug: string;
};

function normalizeHostname(hostname: string): string | null {
  const normalized = hostname
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/^\/+|\/+$/g, '')
    .toLowerCase();

  if (!normalized || !HOSTNAME_PATTERN.test(normalized)) {
    return null;
  }

  return normalized;
}

function toHttpsOrigin(hostname: string): string | null {
  const normalized = normalizeHostname(hostname);
  if (!normalized) return null;

  return new URL(`https://${normalized}`).origin;
}

function merchantSubdomainOrigin(slug: string): string | null {
  const rootDomain = normalizeHostname(getRootDomain() || 'usebaci.com');
  const normalizedSlug = slug.trim().toLowerCase();
  if (!rootDomain || !normalizedSlug) return null;
  return toHttpsOrigin(`${normalizedSlug}.${rootDomain}`);
}

function buildTrustedStorefrontRedirectOrigins(
  merchant: StorefrontOAuthMerchant
): Set<string> {
  const trustedOrigins = new Set<string>();
  trustedOrigins.add(new URL(getAppUrl()).origin);

  const subdomainOrigin = merchantSubdomainOrigin(merchant.slug);
  if (subdomainOrigin) trustedOrigins.add(subdomainOrigin);

  if (merchant.custom_domain) {
    const customDomainOrigin = toHttpsOrigin(merchant.custom_domain);
    if (customDomainOrigin) {
      trustedOrigins.add(customDomainOrigin);
      const customHost = normalizeHostname(merchant.custom_domain);
      if (customHost) {
        const bareHost = customHost.replace(/^www\./, '');
        const wwwOrigin = toHttpsOrigin(`www.${bareHost}`);
        const bareOrigin = toHttpsOrigin(bareHost);
        if (wwwOrigin) trustedOrigins.add(wwwOrigin);
        if (bareOrigin) trustedOrigins.add(bareOrigin);
      }
    }
  }

  return trustedOrigins;
}

export const STOREFRONT_OAUTH_NEXT_COOKIE = 'baci_oauth_next';

/**
 * Splits a `?next=` return target off `/account/callback` URLs before handing
 * `redirectTo` to Supabase GoTrue. Hosted Supabase allowlists exact callback
 * URLs (such as `https://ogabassey.com/account/callback`), which reject
 * query-suffixed URLs and fall back to `site_url` (`https://usebaci.com`).
 */
export function extractStorefrontOAuthCallbackNext(
  trustedRedirectUrl: string,
  expectedMerchantSlug?: string
): {
  redirectTo: string;
  nextTarget: string | null;
} {
  try {
    const parsed = new URL(trustedRedirectUrl);
    const nextParam = parsed.searchParams.get('next');
    const isCallbackPath =
      parsed.pathname === '/account/callback' ||
      /^\/[^/]+\/account\/callback$/.test(parsed.pathname);

    if (nextParam && isCallbackPath) {
      let validatedNextTarget: string | null = null;
      try {
        const nextUrl = new URL(nextParam, parsed.origin);
        const isCheckoutTarget = expectedMerchantSlug
          ? nextUrl.pathname === '/checkout' ||
            nextUrl.pathname === `/${expectedMerchantSlug}/checkout`
          : nextUrl.pathname === '/checkout' ||
            /^\/[^/]+\/checkout$/.test(nextUrl.pathname);

        if (nextUrl.origin === parsed.origin && isCheckoutTarget) {
          validatedNextTarget = `${nextUrl.pathname}${nextUrl.search}`;
        }
      } catch {
        // Invalid next URLs are dropped rather than persisted into the cookie.
      }

      parsed.search = '';
      return {
        redirectTo: parsed.toString(),
        nextTarget: validatedNextTarget,
      };
    }
  } catch {
    // Fall through with original URL.
  }

  return {
    redirectTo: trustedRedirectUrl,
    nextTarget: null,
  };
}

/**
 * The merchant's canonical storefront origin to land OAuth callbacks on: the
 * custom domain if set, else the {slug}.rootDomain subdomain.
 */
function canonicalStorefrontOrigin(
  merchant: StorefrontOAuthMerchant
): string | null {
  if (merchant.custom_domain) {
    const customDomainOrigin = toHttpsOrigin(merchant.custom_domain);
    if (customDomainOrigin) return customDomainOrigin;
  }
  return merchantSubdomainOrigin(merchant.slug);
}

export function resolveTrustedStorefrontRedirectUrl(
  redirectUrl: string | undefined,
  merchant: StorefrontOAuthMerchant,
  // The identifier the request presented (body `merchantSlug`). After a rename it
  // may be the RETIRED slug that aliased to this merchant; we use it to recognize —
  // and re-point — a redirectUrl still sitting on the old subdomain.
  requestedIdentifier?: string
): string | null {
  const appOrigin = new URL(getAppUrl()).origin;

  if (!redirectUrl) {
    return new URL('/account', appOrigin).toString();
  }

  try {
    const parsed = redirectUrl.startsWith('/')
      ? new URL(redirectUrl, appOrigin)
      : new URL(redirectUrl);

    if (buildTrustedStorefrontRedirectOrigins(merchant).has(parsed.origin)) {
      return parsed.toString();
    }

    // Retired-alias fallback: a customer with a tab still open on the OLD subdomain
    // after a rename posts a redirectUrl on that retired origin. When the request's
    // identifier is the retired slug that resolved THIS merchant via the alias
    // table, re-point the redirect onto the merchant's canonical origin (preserving
    // path/query/hash) instead of rejecting the in-flight login. We never blindly
    // trust the old origin — only the specific retired slug the request presented,
    // and only after moving it to the canonical host.
    if (requestedIdentifier) {
      const retiredOrigin = merchantSubdomainOrigin(requestedIdentifier);
      const canonicalOrigin = canonicalStorefrontOrigin(merchant);
      if (
        retiredOrigin &&
        canonicalOrigin &&
        retiredOrigin === parsed.origin &&
        retiredOrigin !== canonicalOrigin
      ) {
        const canonical = new URL(canonicalOrigin);
        parsed.protocol = canonical.protocol;
        parsed.host = canonical.host;
        return parsed.toString();
      }
    }

    return null;
  } catch {
    return null;
  }
}
