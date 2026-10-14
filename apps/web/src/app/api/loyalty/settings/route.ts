import { cookies } from 'next/headers';
import { type NextRequest, NextResponse } from 'next/server';
import { hasPermission } from '@/lib/api-auth';
import { checkCsrfProtection } from '@/lib/csrf';
import {
  getMerchantForApiRequest,
  toUserAccess,
} from '@/lib/get-merchant-for-api-request';
import { createClient } from '@/lib/supabase/server';
import { loyaltySettingsPostSchema } from '@/schemas/loyalty-settings';

/**
 * Loyalty Settings API
 *
 * GET - Get merchant's loyalty program settings
 * POST - Create/update loyalty program settings
 */

export async function GET() {
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

    const access = toUserAccess(merchantContext);
    if (!hasPermission(access, 'marketing', 'view')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const merchantId = merchantContext.merchantId;

    const { data: settings, error } = await supabase
      .from('loyalty_settings')
      .select(
        'id, merchant_id, enabled, program_name, points_per_currency, points_currency_unit, signup_bonus_points, birthday_bonus_points, review_bonus_points, referral_bonus_points, points_to_currency_ratio, minimum_redemption_points, maximum_redemption_percentage, tiers, points_expiry_days, updated_at'
      )
      .eq('merchant_id', merchantId)
      .single();

    if (error && error.code !== 'PGRST116') {
      console.error('Error fetching loyalty settings:', error);
      return NextResponse.json(
        { error: 'Failed to fetch settings' },
        { status: 500 }
      );
    }

    // Return default settings if none exist
    if (!settings) {
      return NextResponse.json({
        enabled: false,
        program_name: 'Rewards Program',
        points_per_currency: 1.0,
        points_currency_unit: 100,
        signup_bonus_points: 0,
        birthday_bonus_points: 0,
        review_bonus_points: 50,
        referral_bonus_points: 100,
        points_to_currency_ratio: 0.01,
        minimum_redemption_points: 500,
        maximum_redemption_percentage: 50.0,
        tiers: [
          { name: 'Bronze', minPoints: 0, multiplier: 1.0, perks: [] },
          {
            name: 'Silver',
            minPoints: 1000,
            multiplier: 1.25,
            perks: ['free_shipping'],
          },
          {
            name: 'Gold',
            minPoints: 5000,
            multiplier: 1.5,
            perks: ['free_shipping', 'early_access'],
          },
          {
            name: 'Platinum',
            minPoints: 10000,
            multiplier: 2.0,
            perks: ['free_shipping', 'early_access', 'exclusive_discounts'],
          },
        ],
        points_expiry_days: 365,
      });
    }

    return NextResponse.json(settings);
  } catch (error) {
    console.error('Loyalty settings GET error:', error);
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

    // Validate before any database operation: malformed JSON, a
    // non-object body, and wrongly-typed fields fail closed with 400
    // instead of triggering merchant or permission lookups.
    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      return NextResponse.json(
        { error: 'Invalid request body' },
        { status: 400 }
      );
    }
    const parsed = loyaltySettingsPostSchema.safeParse(rawBody);
    if (!parsed.success) {
      const capIssue = parsed.error.issues.some((issue) =>
        issue.path.includes('maximum_redemption_percentage')
      );
      return NextResponse.json(
        {
          error: capIssue
            ? 'maximum_redemption_percentage must be at least 0.01 and at most 100 with up to two decimal places'
            : 'Invalid request body',
        },
        { status: 400 }
      );
    }

    const merchantContext = await getMerchantForApiRequest(supabase, user.id);
    if (!merchantContext) {
      return NextResponse.json(
        { error: 'Merchant not found' },
        { status: 404 }
      );
    }

    const access = toUserAccess(merchantContext);
    if (!hasPermission(access, 'marketing', 'edit')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const merchantId = merchantContext.merchantId;

    const {
      enabled,
      program_name,
      points_per_currency,
      points_currency_unit,
      signup_bonus_points,
      birthday_bonus_points,
      review_bonus_points,
      referral_bonus_points,
      points_to_currency_ratio,
      minimum_redemption_points,
      maximum_redemption_percentage,
      tiers,
      points_expiry_days,
    } = parsed.data;

    const { data: settings, error } = await supabase
      .from('loyalty_settings')
      .upsert(
        {
          merchant_id: merchantId,
          enabled: enabled ?? false,
          program_name: program_name ?? 'Rewards Program',
          points_per_currency: points_per_currency ?? 1.0,
          points_currency_unit: points_currency_unit ?? 100,
          signup_bonus_points: signup_bonus_points ?? 0,
          birthday_bonus_points: birthday_bonus_points ?? 0,
          review_bonus_points: review_bonus_points ?? 50,
          referral_bonus_points: referral_bonus_points ?? 100,
          points_to_currency_ratio: points_to_currency_ratio ?? 0.01,
          minimum_redemption_points: minimum_redemption_points ?? 500,
          maximum_redemption_percentage: maximum_redemption_percentage ?? 50.0,
          tiers: tiers ?? [
            { name: 'Bronze', minPoints: 0, multiplier: 1.0, perks: [] },
            {
              name: 'Silver',
              minPoints: 1000,
              multiplier: 1.25,
              perks: ['free_shipping'],
            },
            {
              name: 'Gold',
              minPoints: 5000,
              multiplier: 1.5,
              perks: ['free_shipping', 'early_access'],
            },
            {
              name: 'Platinum',
              minPoints: 10000,
              multiplier: 2.0,
              perks: ['free_shipping', 'early_access', 'exclusive_discounts'],
            },
          ],
          points_expiry_days: points_expiry_days ?? 365,
          updated_at: new Date().toISOString(),
        },
        {
          onConflict: 'merchant_id',
        }
      )
      .select()
      .single();

    if (error) {
      console.error('Error saving loyalty settings:', error);
      return NextResponse.json(
        { error: 'Failed to save settings' },
        { status: 500 }
      );
    }

    return NextResponse.json(settings);
  } catch (error) {
    console.error('Loyalty settings POST error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
