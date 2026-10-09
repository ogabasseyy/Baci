import { cookies } from 'next/headers';
import { type NextRequest, NextResponse } from 'next/server';
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
  forbidden: 403,
  invalid_input: 400,
  referral_code_collision: 503,
};

const RPC_ERROR_MESSAGE: Record<string, string> = {
  already_enrolled: 'Customer is already enrolled in the loyalty program',
  program_unavailable: 'Loyalty program not available for this merchant',
  customer_not_found: 'Customer not found for this merchant',
  forbidden: 'You can only enroll your own customer account',
  invalid_input: 'Invalid enrollment input',
  referral_code_collision:
    'Enrollment is temporarily unavailable, please try again',
};

// POST - Enroll a customer in loyalty program.
//
// The caller must own the customer row: the session user must match the
// customer resolved for this merchant. The RPC re-verifies ownership, so
// direct invocation with another customer's IDs fails closed too. The
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

    let rawBody: unknown = {};
    try {
      rawBody = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const parsed = storefrontLoyaltyEnrollSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'merchant_id and customer_id are required' },
        { status: 400 }
      );
    }

    // Resolve the caller's own customer row for this merchant. A mismatch
    // returns the same 404 as a missing customer so callers cannot probe
    // which customer IDs exist.
    const { data: customer, error: customerError } = await supabase
      .from('customers')
      .select('id')
      .eq('merchant_id', parsed.data.merchant_id)
      .eq('user_id', user.id)
      .maybeSingle();

    if (customerError) {
      logger.error({
        message: 'Error resolving enrollment customer',
        error: customerError,
      });
      return NextResponse.json(
        { error: 'Failed to enroll in loyalty program' },
        { status: 500 }
      );
    }

    if (!customer || customer.id !== parsed.data.customer_id) {
      return NextResponse.json(
        { error: 'Customer not found for this merchant' },
        { status: 404 }
      );
    }

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
        tier: validated.data.current_tier,
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
