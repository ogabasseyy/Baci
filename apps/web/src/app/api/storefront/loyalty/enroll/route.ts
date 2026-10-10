import { cookies } from 'next/headers';
import { type NextRequest, NextResponse } from 'next/server';
import { checkCsrfProtection } from '@/lib/csrf';
import { logger } from '@/lib/logger';
import { createClient } from '@/lib/supabase/server';
import {
  storefrontLoyaltyEnrollResultSchema,
  storefrontLoyaltyEnrollSchema,
} from '@/schemas/storefront-loyalty-enroll';

type EnrollRpcResult = {
  success: boolean;
  error?: string;
  points_balance?: number;
  current_tier?: string;
  referral_code?: string;
};

const RPC_ERROR_STATUS: Record<string, number> = {
  already_enrolled: 409,
  program_unavailable: 404,
  customer_not_found: 404,
  guest_link_required: 409,
  invalid_input: 400,
  out_of_range: 400,
  referral_code_collision: 503,
};

const RPC_ERROR_MESSAGE: Record<string, string> = {
  already_enrolled: 'Customer is already enrolled in the loyalty program',
  program_unavailable: 'Loyalty program not available for this merchant',
  customer_not_found: 'Customer not found for this merchant',
  guest_link_required:
    'Customer account is not linked to this login. Sign in again to link it, then retry enrollment.',
  invalid_input: 'Invalid enrollment input',
  out_of_range: 'Enrollment bonus is out of range',
  referral_code_collision:
    'Enrollment is temporarily unavailable, please try again',
};

// POST - Enroll a customer in loyalty program.
//
// The caller must own the customer row. Ownership is verified inside the
// RPC (definer's rights): a route-side lookup cannot see unlinked guest
// rows under RLS, so it cannot distinguish re-linkable guests from
// missing rows. Missing, foreign, and soft-deleted rows all map to the
// same 404 so callers cannot probe which customer IDs exist. The
// response shape is kept stable for the use-loyalty.ts enroll() caller.
export async function POST(request: NextRequest) {
  try {
    const cookieStore = await cookies();
    const supabase = createClient(cookieStore);

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    // Cookie-authenticated browsers: reject forged cross-site POSTs before
    // the bonus-bearing enrollment RPC runs (AGENTS.md CSRF rule).
    const { valid: csrfValid, response: csrfResponse } =
      await checkCsrfProtection(request);
    if (!csrfValid) {
      return (
        csrfResponse ??
        NextResponse.json({ error: 'CSRF validation failed' }, { status: 403 })
      );
    }

    let rawBody: unknown = {};
    try {
      rawBody = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const parsed = storefrontLoyaltyEnrollSchema.safeParse(rawBody);
    if (!parsed.success) {
      const body =
        typeof rawBody === 'object' && rawBody !== null
          ? (rawBody as Record<string, unknown>)
          : {};
      const hasIds =
        typeof body.merchant_id === 'string' &&
        typeof body.customer_id === 'string';
      return NextResponse.json(
        {
          error: hasIds
            ? 'Invalid enrollment input'
            : 'merchant_id and customer_id are required',
        },
        { status: 400 }
      );
    }

    // Ownership, liveness, and the guest re-link hint are all evaluated
    // inside the RPC: it sees rows the caller's RLS grants hide. Never
    // short-circuit here — every mismatch shape flows through the same
    // mapping below.
    const { data, error } = await supabase.rpc('enroll_customer_loyalty', {
      p_merchant_id: parsed.data.merchant_id,
      p_customer_id: parsed.data.customer_id,
      p_referral_code: parsed.data.referral_code ?? null,
    });

    if (error) {
      logger.error({
        message: 'Error enrolling in loyalty program',
        error,
      });
      return NextResponse.json(
        { error: 'Failed to enroll in loyalty program' },
        { status: 500 }
      );
    }

    const result = data as EnrollRpcResult | null;
    if (!result?.success) {
      const code = result?.error ?? 'enrollment_failed';
      const status = RPC_ERROR_STATUS[code] ?? 500;
      if (status === 500) {
        logger.error({
          message: 'Unexpected loyalty enrollment result',
          error: { code, result },
        });
      }
      return NextResponse.json(
        {
          error:
            RPC_ERROR_MESSAGE[code] ?? 'Failed to enroll in loyalty program',
        },
        { status }
      );
    }

    const validated = storefrontLoyaltyEnrollResultSchema.safeParse(result);
    if (!validated.success) {
      logger.error({
        message: 'Malformed loyalty enrollment result',
        error: { result },
      });
      return NextResponse.json(
        { error: 'Failed to enroll in loyalty program' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'Successfully enrolled in loyalty program',
      data: {
        points_balance: validated.data.points_balance,
        tier: validated.data.current_tier.toLowerCase(),
        referral_code: validated.data.referral_code,
      },
    });
  } catch (error) {
    logger.error({ message: 'Error in loyalty enrollment', error });
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
