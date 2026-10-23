import { type NextRequest, NextResponse } from 'next/server';
import { authenticateApiRequest } from '@/lib/api-auth';
import { checkCsrfProtection } from '@/lib/csrf';
import {
  getMerchantForApiRequest,
  toUserAccess,
} from '@/lib/get-merchant-for-api-request';
import { getOnboardingReminder } from '@/lib/onboarding-reminders/policy';
import { loadStoreReadiness } from '@/lib/store-readiness/load-store-readiness';
import {
  onboardingReminderQuerySchema,
  onboardingReminderSnoozeSchema,
} from '@/schemas/onboarding-reminder';

const headers = { 'Cache-Control': 'private, no-store' };
function failure(message: string, status: number) {
  return NextResponse.json({ error: message }, { status, headers });
}

async function authorize(request: NextRequest) {
  const auth = await authenticateApiRequest(request);
  if (auth.error || !auth.user || !auth.supabase) {
    return { response: failure('Unauthorized', 401) };
  }
  const query = onboardingReminderQuerySchema.safeParse({
    merchantId: request.nextUrl.searchParams.get('merchantId'),
  });
  if (!query.success) return { response: failure('Invalid merchant', 400) };
  const merchant = await getMerchantForApiRequest(auth.supabase, auth.user.id, {
    requestedMerchantId: query.data.merchantId,
  });
  if (!merchant) return { response: failure('Merchant not found', 404) };
  if (!merchant.staffAccess.isOwner)
    return { response: failure('Forbidden', 403) };
  return { supabase: auth.supabase, user: auth.user, merchant };
}

export async function GET(request: NextRequest) {
  try {
    const context = await authorize(request);
    if (context.response) return context.response;
    const { supabase, user, merchant } = context;
    const merchantId = merchant.merchantId;
    const suppressed = () =>
      NextResponse.json({ merchantId, reminder: null }, { headers });
    const preferences = await supabase
      .from('notification_preferences')
      .select('in_app_enabled, banner_enabled, follow_up_notifications_enabled')
      .eq('merchant_id', merchantId)
      .maybeSingle();
    if (preferences.error) return failure('Could not load reminder', 500);
    if (
      preferences.data &&
      (preferences.data.in_app_enabled === false ||
        preferences.data.banner_enabled === false ||
        preferences.data.follow_up_notifications_enabled === false)
    )
      return suppressed();
    const state = await supabase
      .from('merchant_onboarding_reminder_state')
      .select('snoozed_until')
      .eq('merchant_id', merchantId)
      .eq('user_id', user.id)
      .maybeSingle();
    if (state.error) return failure('Could not load reminder', 500);
    if (
      state.data?.snoozed_until &&
      Date.parse(state.data.snoozed_until) > Date.now()
    ) {
      return suppressed();
    }
    const readiness = await loadStoreReadiness({
      supabase,
      merchantId,
      access: toUserAccess(merchant),
      surface: 'web',
    });
    if (readiness.surface !== 'web')
      return failure('Could not load reminder', 500);
    return NextResponse.json(
      { merchantId, reminder: getOnboardingReminder(readiness) },
      { headers }
    );
  } catch {
    return failure('Could not load reminder', 500);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const context = await authorize(request);
    if (context.response) return context.response;
    const csrf = await checkCsrfProtection(request);
    if (!csrf.valid) return failure('CSRF validation failed', 403);
    const body: unknown = await request.json().catch(() => null);
    if (!onboardingReminderSnoozeSchema.safeParse(body).success) {
      return failure('Invalid reminder action', 400);
    }
    const result = await context.supabase
      .from('merchant_onboarding_reminder_state')
      .upsert(
        {
          merchant_id: context.merchant.merchantId,
          user_id: context.user.id,
          snoozed_until: new Date(
            Date.now() + 24 * 60 * 60 * 1000
          ).toISOString(),
        },
        { onConflict: 'merchant_id,user_id' }
      );
    if (result.error) return failure('Could not snooze reminder', 500);
    return NextResponse.json({ success: true }, { headers });
  } catch {
    return failure('Could not snooze reminder', 500);
  }
}
