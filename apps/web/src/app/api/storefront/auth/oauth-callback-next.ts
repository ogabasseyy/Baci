export const STOREFRONT_OAUTH_NEXT_COOKIE = 'baci_oauth_next';

interface StorefrontOAuthNextCookieStore {
  delete?: (name: string) => unknown;
  set?: (
    name: string,
    value: string,
    options: {
      httpOnly: boolean;
      maxAge: number;
      path: string;
      sameSite: 'lax';
      secure: boolean;
    }
  ) => unknown;
}

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

/** Persists or clears the short-lived httpOnly OAuth checkout return target. */
export function syncStorefrontOAuthNextCookie(
  cookieStore: StorefrontOAuthNextCookieStore,
  nextTarget: string | null
): void {
  if (nextTarget && typeof cookieStore.set === 'function') {
    cookieStore.set(STOREFRONT_OAUTH_NEXT_COOKIE, nextTarget, {
      httpOnly: true,
      maxAge: 600,
      path: '/',
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
    });
  } else if (!nextTarget && typeof cookieStore.delete === 'function') {
    cookieStore.delete(STOREFRONT_OAUTH_NEXT_COOKIE);
  }
}
