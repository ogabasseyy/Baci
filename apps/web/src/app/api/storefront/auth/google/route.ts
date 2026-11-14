import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import z from 'zod';
import type { CachedMerchant } from '@/lib/cached-data';
import { getMerchantByIdentifierOrAlias } from '@/lib/get-merchant-by-identifier-or-alias';
import { createClient } from '@/lib/supabase/server';
import {
  extractStorefrontOAuthCallbackNext,
  resolveTrustedStorefrontRedirectUrl,
  STOREFRONT_OAUTH_NEXT_COOKIE,
} from '../oauth-redirect';

const googleAuthSchema = z.object({
  merchantSlug: z.string().min(1, 'Merchant slug is required'),
  redirectUrl: z.string().trim().min(1).optional(),
});

/**
 * Customer OAuth Authentication - Google Sign-In
 *
 * Initiates Google OAuth flow for storefront customers.
 * Returns the OAuth URL to redirect the user to.
 */

export async function POST(request: Request) {
  try {
    const body = await request.json();

    const validation = googleAuthSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { error: 'Invalid request', details: validation.error.flatten() },
        { status: 400 }
      );
    }

    const { merchantSlug, redirectUrl } = validation.data;

    const cookieStore = await cookies();
    const supabase = createClient(cookieStore);

    // Resolve the merchant by slug or custom domain via the shared cached
    // helper. It sources custom_domain from public.domains (the `merchants`
    // table has no such column), so it works for both 'ogabassey' and
    // 'ogabassey.com'.
    const merchant: CachedMerchant | null =
      await getMerchantByIdentifierOrAlias(merchantSlug);

    if (!merchant) {
      return NextResponse.json({ error: 'Store not found' }, { status: 404 });
    }

    if (!merchant.is_published) {
      return NextResponse.json(
        { error: 'Store is not available' },
        { status: 403 }
      );
    }

    const trustedRedirectUrl = resolveTrustedStorefrontRedirectUrl(
      redirectUrl,
      merchant,
      merchantSlug
    );
    if (!trustedRedirectUrl) {
      return NextResponse.json(
        { error: 'Invalid redirectUrl', code: 'INVALID_REDIRECT_URL' },
        { status: 400 }
      );
    }

    const { redirectTo, nextTarget } = extractStorefrontOAuthCallbackNext(
      trustedRedirectUrl,
      merchant.slug
    );
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

    // Initiate Google OAuth
    const { data, error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo,
        queryParams: {
          access_type: 'offline',
          prompt: 'consent',
        },
      },
    });

    if (oauthError) {
      console.error('Google OAuth error:', oauthError);
      return NextResponse.json(
        { error: 'Failed to initiate Google sign-in. Please try again.' },
        { status: 500 }
      );
    }

    // Return the OAuth URL for client-side redirect
    return NextResponse.json({
      success: true,
      url: data.url,
    });
  } catch (error) {
    console.error('Google auth error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
