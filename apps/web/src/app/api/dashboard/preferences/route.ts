import { cookies } from 'next/headers';
import { type NextRequest, NextResponse } from 'next/server';
import { parseRequestedMerchantId } from '@/app/api/branches/branch-route-utils';
import { hasPermission } from '@/lib/api-auth';
import { checkCsrfProtection } from '@/lib/csrf';
import {
  getMerchantForApiRequest,
  toUserAccess,
} from '@/lib/get-merchant-for-api-request';
import { createClient } from '@/lib/supabase/server';
import { dashboardPreferencesSchema } from '@/schemas/dashboard-preferences';

const MAX_DASHBOARD_PREFERENCES_BODY_BYTES = 32 * 1024;

export async function GET(_request: Request) {
  try {
    const cookieStore = await cookies();
    const supabase = createClient(cookieStore);

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const requestedMerchant = parseRequestedMerchantId(_request);
    if (requestedMerchant.response) {
      return requestedMerchant.response;
    }

    // Get merchant (supports owners and staff)
    const merchantContext = await getMerchantForApiRequest(supabase, user.id, {
      requestedMerchantId: requestedMerchant.merchantId,
    });
    if (!merchantContext) {
      return NextResponse.json(
        { error: 'Merchant not found' },
        { status: 404 }
      );
    }

    const access = toUserAccess(merchantContext);
    // Layout editors must read the saved document before persisting an edit so
    // that updating one category cannot overwrite other categories. `edit`
    // does not imply `view` in the permission model, so allow editor-only
    // staff to hydrate this non-sensitive layout projection while keeping the
    // POST path gated on `settings.edit` below.
    const canReadPreferences =
      hasPermission(access, 'settings', 'view') ||
      hasPermission(access, 'settings', 'edit');
    if (!canReadPreferences) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const merchantId = merchantContext.merchantId;

    // Get preferences
    const { data: preferences, error } = await supabase
      .from('dashboard_preferences')
      .select('layout_config, visible_cards')
      .eq('merchant_id', merchantId)
      .single();

    if (error && error.code !== 'PGRST116') {
      // PGRST116 is "no rows returned"
      console.error('Error fetching dashboard preferences:', error);
      return NextResponse.json(
        { error: 'Failed to fetch preferences' },
        { status: 500 }
      );
    }

    // Return default if no preferences found
    if (!preferences) {
      return NextResponse.json({
        layout_config: [],
        visible_cards: [
          'revenue',
          'orders',
          'customers',
          'products',
          'sales_by_channel',
          'top_products',
        ],
      });
    }

    return NextResponse.json(preferences);
  } catch (error) {
    console.error('Error in dashboard preferences API:', error);
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
        NextResponse.json({ error: 'Invalid CSRF token' }, { status: 403 })
      );
    }

    const declaredLength = Number(request.headers.get('content-length'));
    if (
      Number.isFinite(declaredLength) &&
      declaredLength > MAX_DASHBOARD_PREFERENCES_BODY_BYTES
    ) {
      return NextResponse.json(
        { error: 'Dashboard preferences payload is too large' },
        { status: 413 }
      );
    }

    const rawBody = await request.text();
    if (
      new TextEncoder().encode(rawBody).byteLength >
      MAX_DASHBOARD_PREFERENCES_BODY_BYTES
    ) {
      return NextResponse.json(
        { error: 'Dashboard preferences payload is too large' },
        { status: 413 }
      );
    }

    let body: unknown;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const parsedBody = dashboardPreferencesSchema.safeParse(body);
    if (!parsedBody.success) {
      return NextResponse.json(
        { error: 'Invalid dashboard preferences' },
        { status: 400 }
      );
    }

    const requestedMerchant = parseRequestedMerchantId(request);
    if (requestedMerchant.response) {
      return requestedMerchant.response;
    }

    // Get merchant (supports owners and staff)
    const merchantContext = await getMerchantForApiRequest(supabase, user.id, {
      requestedMerchantId: requestedMerchant.merchantId,
    });
    if (!merchantContext) {
      return NextResponse.json(
        { error: 'Merchant not found' },
        { status: 404 }
      );
    }

    const access = toUserAccess(merchantContext);
    if (!hasPermission(access, 'settings', 'edit')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const merchantId = merchantContext.merchantId;

    // Upsert preferences
    const { data, error } = await supabase
      .from('dashboard_preferences')
      .upsert(
        {
          merchant_id: merchantId,
          ...(parsedBody.data.layout_config !== undefined
            ? { layout_config: parsedBody.data.layout_config }
            : {}),
          ...(parsedBody.data.visible_cards !== undefined
            ? { visible_cards: parsedBody.data.visible_cards }
            : {}),
          updated_at: new Date().toISOString(),
        },
        {
          onConflict: 'merchant_id',
        }
      )
      .select('layout_config, visible_cards')
      .single();

    if (error) {
      console.error('Error saving dashboard preferences:', error);
      return NextResponse.json(
        { error: 'Failed to save preferences' },
        { status: 500 }
      );
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error('Error in dashboard preferences API:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
