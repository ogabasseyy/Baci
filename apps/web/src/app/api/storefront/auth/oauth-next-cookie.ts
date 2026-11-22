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
