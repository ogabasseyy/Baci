import { cookies } from 'next/headers';
import { type NextRequest, NextResponse } from 'next/server';
import { checkCsrfProtection } from '@/lib/csrf';
import { getMerchantForApiRequest } from '@/lib/get-merchant-for-api-request';
import { createLoyaltyRecordWithRetry } from '@/lib/loyalty-manual-record';
import { createClient } from '@/lib/supabase/server';
import { loyaltyManualPointsSchema } from '@/schemas/loyalty-manual-points';

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

    // Get current loyalty record (or create one)
    const { data: initialLoyalty, error: loyaltyError } = await supabase
      .from('customer_loyalty')
      .select('id, points_balance, lifetime_points, current_tier')
      .eq('merchant_id', merchantId)
      .eq('customer_id', customerId)
      .single();

    let loyalty = initialLoyalty;

    if (loyaltyError && loyaltyError.code === 'PGRST116') {
      // Create new loyalty record, retrying referral-code collisions.
      const created = await createLoyaltyRecordWithRetry(
        supabase,
        merchantId,
        customerId
      );
      if (!created) {
        return NextResponse.json(
          { error: 'Failed to create loyalty record' },
          { status: 500 }
        );
      }
      loyalty = created;
    } else if (loyaltyError) {
      console.error('Error fetching loyalty:', loyaltyError);
      return NextResponse.json(
        { error: 'Failed to fetch loyalty record' },
        { status: 500 }
      );
    }

    // Check for negative balance
    const newBalance = (loyalty?.points_balance || 0) + points;
    if (newBalance < 0) {
      return NextResponse.json(
        { error: 'Cannot reduce points below zero' },
        { status: 400 }
      );
    }

    // Update points balance
    const newLifetime =
      points > 0
        ? (loyalty?.lifetime_points || 0) + points
        : loyalty?.lifetime_points || 0;

    // Recompute the tier from the new lifetime total: the storefront
    // status path trusts the persisted current_tier, so a manual award
    // crossing a threshold must not leave it stale.
    let newTier: string | null = null;
    const { data: tierData, error: tierError } = await supabase.rpc(
      'calculate_loyalty_tier',
      {
        p_lifetime_points: newLifetime,
        p_merchant_id: merchantId,
      }
    );
    if (tierError) {
      console.error('Error recomputing loyalty tier:', tierError);
    } else if (typeof tierData === 'string' && tierData.length > 0) {
      newTier = tierData;
    }

    const loyaltyUpdate: Record<string, unknown> = {
      points_balance: newBalance,
      lifetime_points: newLifetime,
      updated_at: new Date().toISOString(),
    };
    const previousTier = (loyalty as { current_tier?: string } | null)
      ?.current_tier;
    if (newTier !== null && newTier !== previousTier) {
      loyaltyUpdate.current_tier = newTier;
      loyaltyUpdate.tier_updated_at = new Date().toISOString();
    }

    const { error: updateError } = await supabase
      .from('customer_loyalty')
      .update(loyaltyUpdate)
      .eq('id', loyalty?.id)
      .eq('merchant_id', merchantId);

    if (updateError) {
      console.error('Error updating points:', updateError);
      return NextResponse.json(
        { error: 'Failed to update points' },
        { status: 500 }
      );
    }

    // Record transaction
    const { error: txError } = await supabase
      .from('points_transactions')
      .insert({
        customer_id: customerId,
        merchant_id: merchantId,
        type: type,
        points: points,
        balance_after: newBalance,
        source: 'admin_adjust',
        description:
          reason ||
          `Manual adjustment by merchant: ${points > 0 ? '+' : ''}${points} points`,
      });

    if (txError) {
      console.error('Error recording transaction:', txError);
      // Don't fail - points were updated successfully
    }

    return NextResponse.json({
      success: true,
      newBalance,
      lifetimePoints: newLifetime,
      pointsAwarded: points,
    });
  } catch (error) {
    console.error('Points POST error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
