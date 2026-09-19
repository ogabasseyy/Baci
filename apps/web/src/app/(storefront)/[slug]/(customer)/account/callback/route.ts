import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import { logger } from '@/lib/logger';
import { createClient } from '@/lib/supabase/server';

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
    const loginPath = slug ? `/${slug}/account/login` : '/account/login';
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
    const loginPath = slug ? `/${slug}/account/login` : '/account/login';
    return NextResponse.redirect(
      `${origin}${loginPath}?error=No authorization code provided`
    );
  }

  try {
    const cookieStore = await cookies();
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
      const loginPath = slug ? `/${slug}/account/login` : '/account/login';
      return NextResponse.redirect(
        `${origin}${loginPath}?error=${encodeURIComponent(exchangeError.message)}`
      );
    }

    // Success! Redirect to the account page
    // Use the slug to maintain proper routing
    const accountPath = slug ? `/${slug}/account` : '/account';

    logger.info({
      message: 'OAuth successful for user',
      userId: data.user?.id,
      slug,
    });

    return NextResponse.redirect(`${origin}${accountPath}`);
  } catch (err) {
    logger.error({
      message: 'Unexpected error during OAuth callback',
      error: err instanceof Error ? err.message : 'Unknown error',
      slug,
    });
    const loginPath = slug ? `/${slug}/account/login` : '/account/login';
    return NextResponse.redirect(
      `${origin}${loginPath}?error=An unexpected error occurred`
    );
  }
}
