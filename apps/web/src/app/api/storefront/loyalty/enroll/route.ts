import { cookies } from 'next/headers';
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { logger } from '@/lib/logger';
import { createClient } from '@/lib/supabase/server';

const enrollSchema = z.object({
  merchant_id: z.uuid(),
  customer_id: z.uuid(),
  // customer_loyalty.referral_code is varchar(20); the RPC matches case-insensitively.
  referral_code: z.string().trim().min(1).max(20).optional(),
});

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
  invalid_input: 400,
};

const RPC_ERROR_MESSAGE: Record<string, string> = {
  already_enrolled: 'Customer is already enrolled in the loyalty program',
  program_unavailable: 'Loyalty program not available for this merchant',
  customer_not_found: 'Customer not found for this merchant',
  invalid_input: 'Invalid enrollment input',
};

// POST - Enroll a customer in loyalty program.
//
// All enrollment logic runs atomically inside the enroll_customer_loyalty
// SECURITY DEFINER RPC; this route only validates input and maps the RPC
// result to HTTP status codes. The response shape is kept stable for the
// use-loyalty.ts enroll() caller.
export async function POST(request: NextRequest) {
  try {
    let rawBody: unknown = {};
    try {
      rawBody = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const parsed = enrollSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'merchant_id and customer_id are required' },
        { status: 400 }
      );
    }

    const cookieStore = await cookies();
    const supabase = createClient(cookieStore);

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

    return NextResponse.json({
      success: true,
      message: 'Successfully enrolled in loyalty program',
      data: {
        points_balance: result.points_balance,
        tier: result.current_tier,
        referral_code: result.referral_code,
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
