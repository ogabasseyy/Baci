import { isAuthSessionMissingError } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { resolveStorefrontAuthMerchant } from '../resolve-storefront-auth-merchant';
import { reconcileStorefrontCustomer } from './reconcile-storefront-customer';

/**
 * Customer Auth Session
 *
 * GET - Returns the current customer session and customer data
 */

// react-doctor-disable-next-line react-doctor/nextjs-no-side-effect-in-get-handler -- Storefront session hydration intentionally reconciles the signed-in customer; guarded by Supabase auth and merchant lookup.
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const merchantSlug = searchParams.get('merchantSlug');

    if (!merchantSlug) {
      return NextResponse.json(
        { error: 'Merchant slug is required' },
        { status: 400 }
      );
    }

    const cookieStore = await cookies();
    const supabase = createClient(cookieStore);

    // Get current auth session
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError) {
      if (isAuthSessionMissingError(authError)) {
        return NextResponse.json({
          authenticated: false,
          user: null,
          customer: null,
        });
      }
      console.error('Storefront auth session lookup failed:', authError);
      return NextResponse.json(
        { error: 'Session lookup failed' },
        { status: 503 }
      );
    }

    if (!user) {
      return NextResponse.json({
        authenticated: false,
        user: null,
        customer: null,
      });
    }

    // Check if user is a customer (not a merchant)
    const userRole = user.user_metadata?.role;
    if (userRole === 'merchant') {
      // Merchants should not be treated as customers on storefront
      return NextResponse.json({
        authenticated: false,
        user: null,
        customer: null,
        reason: 'merchant_account',
      });
    }

    const merchant = await resolveStorefrontAuthMerchant(
      supabase,
      merchantSlug
    );

    if (!merchant) {
      return NextResponse.json({ error: 'Store not found' }, { status: 404 });
    }

    const customer = await reconcileStorefrontCustomer(
      supabase,
      merchant.id,
      user
    );

    return NextResponse.json({
      authenticated: true,
      user: {
        id: user.id,
        email: user.email ?? null,
        role: userRole || 'customer',
      },
      customer,
    });
  } catch (error) {
    console.error('Session check error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
