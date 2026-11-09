import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import { STOREFRONT_OAUTH_NEXT_COOKIE } from '@/app/api/storefront/auth/oauth-redirect';
import { logger } from '@/lib/logger';
import { createClient } from '@/lib/supabase/server';
import { isDomainIdentifier } from '@/lib/validation';

// Region pinning lives in vercel.json `regions` (dub1) — `preferredRegion`
// is deprecated and removed.

/**
 * Storefront OAuth Callback Handler
 *
 * This route handles the OAuth callback for storefront customer authentication.
 * It exchanges the authorization code for a session and redirects to the account page.
 *
 * This is necessary for custom domains (e.g., ogabassey.com) where cookies must be
 * set on the same domain that initiated the OAuth flow.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const error = searchParams.get('error');
  const errorDescription = searchParams.get('error_description');
  const { slug } = await params;
  const isCustomDomain =
    Boolean(request.headers.get('x-custom-domain')) || isDomainIdentifier(slug);
  const basePath = slug && !isCustomDomain ? `/${slug}` : '';
  const loginPath = `${basePath}/account/login`;

  const cookieStore = await cookies();
  const cookieNext = cookieStore.get?.(STOREFRONT_OAUTH_NEXT_COOKIE)?.value;

  // If there's an OAuth error from the provider
  if (error) {
    // Explicit sanitization to satisfy CodeQL log injection flow analysis
    const safeError = String(error)
      .replace(/[\r\n]/g, ' ')
      .slice(0, 200);
    const safeDesc = String(errorDescription ?? '')
      .replace(/[\r\n]/g, ' ')
      .slice(0, 500);

    logger.error({
      message: 'OAuth callback error',
      error: safeError,
      description: safeDesc,
      slug,
    });
    return NextResponse.redirect(
      `${origin}${loginPath}?error=${encodeURIComponent(errorDescription || error)}`
    );
  }

  // No code provided
  if (!code) {
    logger.error({
      message: 'No authorization code provided in OAuth callback',
      slug,
    });
    return NextResponse.redirect(
      `${origin}${loginPath}?error=No authorization code provided`
    );
  }

  try {
    const supabase = createClient(cookieStore);

    // Exchange the authorization code for a session
    const { data, error: exchangeError } =
      await supabase.auth.exchangeCodeForSession(code);

    if (exchangeError) {
      logger.error({
        message: 'Failed to exchange code for session',
        error: exchangeError.message,
        slug,
      });
      return NextResponse.redirect(
        `${origin}${loginPath}?error=${encodeURIComponent(exchangeError.message)}`
      );
    }

    if (cookieNext && typeof cookieStore.delete === 'function') {
      cookieStore.delete(STOREFRONT_OAUTH_NEXT_COOKIE);
    }

    // Success! Redirect to the account page (or checkout-return when resuming checkout)
    const accountPath = `${basePath}/account`;
    const next = searchParams.get('next') ?? cookieNext ?? null;
    let destination = accountPath;
    if (next) {
      let parsed: URL | null = null;
      try {
        parsed = new URL(next, origin);
      } catch {
        // Invalid return paths fall back to the account page.
      }
      if (
        parsed?.origin === origin &&
        (parsed.pathname === '/checkout' ||
          (!isCustomDomain && parsed.pathname === `/${slug}/checkout`))
      ) {
        const checkoutPath = `${parsed.pathname}${parsed.search}`;
        destination = `${basePath}/account/checkout-return?next=${encodeURIComponent(checkoutPath)}`;
      }
    }

    logger.info({
      message: 'OAuth successful for user',
      userId: data.user?.id,
      slug,
    });

    return NextResponse.redirect(`${origin}${destination}`);
  } catch (err) {
    logger.error({
      message: 'Unexpected error during OAuth callback',
      error: err instanceof Error ? err.message : 'Unknown error',
      slug,
    });
    return NextResponse.redirect(
      `${origin}${loginPath}?error=An unexpected error occurred`
    );
  }
}
