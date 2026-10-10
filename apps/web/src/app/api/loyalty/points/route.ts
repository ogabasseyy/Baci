import { cookies } from 'next/headers';
import { type NextRequest, NextResponse } from 'next/server';
import { checkCsrfProtection } from '@/lib/csrf';
import { getMerchantForApiRequest } from '@/lib/get-merchant-for-api-request';
import { createClient } from '@/lib/supabase/server';
import {
  type LoyaltyManualPointsResult,
  loyaltyManualPointsResultSchema,
  loyaltyManualPointsSchema,
} from '@/schemas/loyalty-manual-points';

type AdjustRpcResult = {
  success: boolean;
  error?: string;
} & Partial<LoyaltyManualPointsResult>;

const RPC_ERROR_STATUS: Record<string, number> = {
  invalid_input: 400,
  merchant_not_found: 404,
  customer_not_found: 404,
  negative_balance: 400,
  out_of_range: 400,
  creation_failed: 500,
};

const RPC_ERROR_MESSAGE: Record<string, string> = {
  invalid_input: 'Invalid manual award input',
  merchant_not_found: 'Merchant not found',
  customer_not_found: 'Customer not found for this merchant',
  negative_balance: 'Cannot reduce points below zero',
  out_of_range: 'Points adjustment is out of range',
  creation_failed: 'Failed to create loyalty record',
};

/**
 * Points Management API
 *
 * GET - Get points transactions for a customer
 * POST - Award points manually (admin action)
 *
 * Query params (GET):
 * - customerId: string (required)
 * - page: number
 * - limit: number
 */

export async function GET(request: NextRequest) {
  try {
    const cookieStore = await cookies();
    const supabase = createClient(cookieStore);

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const merchantContext = await getMerchantForApiRequest(supabase, user.id);
    if (!merchantContext) {
      return NextResponse.json(
        { error: 'Merchant not found' },
        { status: 404 }
      );
    }
    const merchantId = merchantContext.merchantId;

    const { searchParams } = new URL(request.url);
    const customerId = searchParams.get('customerId');
    const page = Number.parseInt(searchParams.get('page') || '1', 10);
    const limit = Math.min(
      Number.parseInt(searchParams.get('limit') || '20', 10),
      100
    );
    const offset = (page - 1) * limit;

    if (!customerId) {
      return NextResponse.json(
        { error: 'customerId is required' },
        { status: 400 }
      );
    }

    const {
      data: transactions,
      error,
      count,
    } = await supabase
      .from('points_transactions')
      // PERFORMANCE: Use explicit column selection instead of .select('*') to prevent overfetching full rows
      .select(
        'id, customer_id, merchant_id, type, points, balance_after, source, source_id, description, expires_at, expired, metadata, created_at',
        { count: 'exact' }
      )
      .eq('merchant_id', merchantId)
      .eq('customer_id', customerId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      console.error('Error fetching transactions:', error);
      return NextResponse.json(
        { error: 'Failed to fetch transactions' },
        { status: 500 }
      );
    }

    // Get customer's current balance
    const { data: loyalty } = await supabase
      .from('customer_loyalty')
      .select('points_balance, lifetime_points, current_tier')
      .eq('merchant_id', merchantId)
      .eq('customer_id', customerId)
      .single();

    return NextResponse.json({
      transactions,
      customerStats: loyalty || {
        points_balance: 0,
        lifetime_points: 0,
        current_tier: 'Bronze',
      },
      pagination: {
        page,
        limit,
        total: count || 0,
        totalPages: Math.ceil((count || 0) / limit),
      },
    });
  } catch (error) {
    console.error('Points transactions GET error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const cookieStore = await cookies();
    const supabase = createClient(cookieStore);

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { valid, response } = await checkCsrfProtection(request);
    if (!valid) {
      return (
        response ??
        NextResponse.json({ error: 'CSRF validation failed' }, { status: 403 })
      );
    }

    const merchantContext = await getMerchantForApiRequest(supabase, user.id);
    if (!merchantContext) {
      return NextResponse.json(
        { error: 'Merchant not found' },
        { status: 404 }
      );
    }
    const merchantId = merchantContext.merchantId;

    let rawBody: unknown = {};
    try {
      rawBody = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const parsed = loyaltyManualPointsSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error:
            'customerId must be a UUID and points must be a non-zero integer',
        },
        { status: 400 }
      );
    }
    const { customerId, points, reason, type } = parsed.data;

    // Adjust through the atomic RPC: it re-verifies merchant membership
    // and the customer row, serializes first-award creation, and locks
    // the member row for the read-modify-write. Direct writes race and
    // skip the customer check, and tolerated partial writes (points
    // updated, ledger insert failed) corrupt the ledger balance.
    const { data, error } = await supabase.rpc('adjust_loyalty_points', {
      p_merchant_id: merchantId,
      p_customer_id: customerId,
      p_points: points,
      p_reason: reason ?? null,
      p_type: type,
    });

    if (error) {
      console.error('Error adjusting loyalty points:', error);
      return NextResponse.json(
        { error: 'Failed to update points' },
        { status: 500 }
      );
    }

    const result = data as AdjustRpcResult | null;
    if (!result?.success) {
      const code = result?.error ?? 'adjust_failed';
      const status = RPC_ERROR_STATUS[code] ?? 500;
      if (status === 500) {
        console.error('Unexpected manual-adjust result:', { code, result });
      }
      return NextResponse.json(
        { error: RPC_ERROR_MESSAGE[code] ?? 'Failed to update points' },
        { status }
      );
    }

    const validated = loyaltyManualPointsResultSchema.safeParse(result);
    if (!validated.success) {
      console.error('Malformed manual-adjust result:', result);
      return NextResponse.json(
        { error: 'Failed to update points' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      newBalance: validated.data.new_balance,
      lifetimePoints: validated.data.lifetime_points,
      pointsAwarded: validated.data.points_awarded,
    });
  } catch (error) {
    console.error('Points POST error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
