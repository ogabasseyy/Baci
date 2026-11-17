import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import {
  CUSTOMER_SESSION_HINT_COOKIE,
  CUSTOMER_SESSION_HINT_MAX_AGE_SECONDS,
} from '@/contexts/customer-session-hint';
import { logger } from '@/lib/logger';
import {
  checkStorefrontOtpVerifyLockout,
  recordStorefrontOtpVerifyFailure,
  resetStorefrontOtpVerifyFailures,
} from '@/lib/storefront-auth-abuse';
import { createClient } from '@/lib/supabase/server';
import { verifyCodeSchema } from '@/schemas/auth';
import { resolveStorefrontAuthMerchant } from '../resolve-storefront-auth-merchant';

/**
 * Customer OTP Authentication - Verify Code
 *
 * Verifies the 6-digit OTP code and creates/links the customer record.
 * Security: Uses Zod schema validation and server-validated email from auth response.
 */

export async function POST(request: Request) {
  try {
    const body = await request.json();

    // Validate input with Zod schema - this ensures proper types and formats
    const validationResult = verifyCodeSchema.safeParse(body);
    if (!validationResult.success) {
      const firstError = validationResult.error.issues[0];
      return NextResponse.json(
        { error: firstError?.message || 'Invalid input' },
        { status: 400 }
      );
    }

    const { audience, email, token, merchantSlug } = validationResult.data;

    const cookieStore = await cookies();
    const supabase = createClient(cookieStore);

    const merchant = await resolveStorefrontAuthMerchant(
      supabase,
      merchantSlug
    );

    if (!merchant) {
      return NextResponse.json({ error: 'Store not found' }, { status: 404 });
    }

    const lockout = await checkStorefrontOtpVerifyLockout({
      email,
      merchantId: merchant.id,
    });
    if (lockout.locked) {
      return NextResponse.json(
        {
          error:
            'Too many failed verification attempts. Please request a new code later.',
        },
        { status: 429 }
      );
    }

    // Verify OTP code
    const { data: authData, error: verifyError } =
      await supabase.auth.verifyOtp({
        email,
        token,
        type: 'email',
      });

    if (verifyError || !authData.user) {
      const redactedEmail = email
        ? `${email.slice(0, 3)}***@${email.split('@')[1]}`
        : 'unknown';
      const verifyErrorMessage = verifyError?.message ?? '';
      const isExpectedOtpFailure =
        verifyErrorMessage.includes('expired') ||
        verifyErrorMessage.includes('invalid');
      const logVerificationFailure = isExpectedOtpFailure
        ? logger.warn
        : logger.error;

      logVerificationFailure({
        message: 'OTP verification error',
        error: verifyError,
        email: redactedEmail,
      });

      await recordStorefrontOtpVerifyFailure({
        email,
        merchantId: merchant.id,
      });

      if (verifyErrorMessage.includes('expired')) {
        return NextResponse.json(
          { error: 'Verification code has expired. Please request a new one.' },
          { status: 400 }
        );
      }

      if (verifyErrorMessage.includes('invalid')) {
        return NextResponse.json(
          { error: 'Invalid verification code. Please check and try again.' },
          { status: 400 }
        );
      }

      return NextResponse.json(
        { error: 'Verification failed. Please try again.' },
        { status: 400 }
      );
    }

    await resetStorefrontOtpVerifyFailures({
      email,
      merchantId: merchant.id,
    });

    // SECURITY: Use server-validated email from auth response, not user input
    // This ensures we trust data from Supabase Auth after successful verification
    const verifiedEmail = authData.user.email;
    if (!verifiedEmail) {
      return NextResponse.json(
        { error: 'Authentication failed: missing email' },
        { status: 400 }
      );
    }

    // Set user metadata to mark as customer (if not already set)
    const currentMetadata = authData.user.user_metadata || {};
    if (currentMetadata.role !== 'customer') {
      await supabase.auth.updateUser({
        data: {
          ...currentMetadata,
          role: 'customer',
        },
      });
    }

    // Upsert customer record using our database function
    // Using verifiedEmail from auth response for security
    const { data: customerId, error: customerError } = await supabase.rpc(
      'upsert_customer_on_auth',
      {
        p_merchant_id: merchant.id,
        p_user_id: authData.user.id,
        p_email: verifiedEmail,
        p_full_name: authData.user.user_metadata?.full_name || null,
        p_phone: authData.user.user_metadata?.phone || null,
      }
    );

    if (customerError) {
      logger.error({
        message: 'Customer upsert error',
        error: customerError,
        merchantId: merchant.id,
        userId: authData.user.id,
      });
      // Don't fail the login, just log the error
    }

    // Fetch the customer record
    const { data: customer } = await supabase
      .from('customers')
      .select(
        'id, full_name, email, phone, date_of_birth, saved_addresses, total_orders, total_spent'
      )
      .eq('merchant_id', merchant.id)
      .eq('user_id', authData.user.id)
      .single();

    // Defense-in-depth: only honor audience='native' (which returns the
    // refresh_token in the JSON body) when the request is not from a browser
    // origin. In-page scripts could otherwise spoof audience='native' to read
    // the refresh_token; native fetch sends no http(s) Origin header.
    const requestOrigin = request.headers.get('origin');
    const isBrowserOrigin = !!requestOrigin && /^https?:/i.test(requestOrigin);
    const resolvedAudience = isBrowserOrigin ? 'storefront-web' : audience;

    if (
      resolvedAudience === 'native' &&
      (!authData.session?.access_token || !authData.session.refresh_token)
    ) {
      logger.error({
        message: 'Native OTP verification missing full session',
        merchantId: merchant.id,
        userId: authData.user.id,
      });
      return NextResponse.json(
        { error: 'Authentication failed. Please try again.' },
        { status: 500 }
      );
    }

    // The native guard above already 500s when the session/tokens are absent,
    // so narrowing on `baseSession` here keeps the native fields typed as
    // strings (no spurious `| undefined`) without a non-null assertion.
    const baseSession = authData.session;
    const session =
      resolvedAudience === 'native' && baseSession
        ? {
            access_token: baseSession.access_token,
            refresh_token: baseSession.refresh_token,
            token_type: baseSession.token_type,
            expires_in: baseSession.expires_in,
            expires_at: baseSession.expires_at,
          }
        : {
            access_token: baseSession?.access_token,
            expires_at: baseSession?.expires_at,
          };

    const response = NextResponse.json({
      success: true,
      message: 'Login successful',
      user: {
        id: authData.user.id,
        email: verifiedEmail,
      },
      customer: customer || {
        id: customerId,
        email: verifiedEmail,
        full_name: verifiedEmail.split('@')[0],
      },
      session,
    });

    if (resolvedAudience !== 'native') {
      response.cookies.set(CUSTOMER_SESSION_HINT_COOKIE, '1', {
        path: '/',
        maxAge: CUSTOMER_SESSION_HINT_MAX_AGE_SECONDS,
        sameSite: 'lax',
        secure: new URL(request.url).protocol === 'https:',
      });
    }

    return response;
  } catch (error) {
    logger.error({
      message: 'Verify code internal error',
      error: error instanceof Error ? error : 'Unknown error',
    });
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
