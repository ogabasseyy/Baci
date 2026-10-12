import type { SupabaseClient, User } from '@supabase/supabase-js';
import { type NextRequest, NextResponse } from 'next/server';
import { resolveCustomerSavingsContext } from '@/app/api/storefront/customer/savings/shared';
import { authenticateApiRequest } from '@/lib/api-auth';
import { checkCsrfProtection } from '@/lib/csrf';
import {
  customerSavingsNotificationPreferencesSchema,
  customerSavingsNotificationsApiResponseSchema,
  customerSavingsNotificationsQuerySchema,
  customerSavingsNotificationsResponseSchema,
  customerSavingsNotificationsUpdateRequestSchema,
} from '@/schemas/customer-savings-notifications';

function unavailable() {
  return NextResponse.json(
    { error: 'Savings notifications are temporarily unavailable' },
    { status: 503 }
  );
}

function invalidInput(details?: unknown) {
  return NextResponse.json(
    { error: 'Invalid input', ...(details ? { details } : {}) },
    { status: 400 }
  );
}

type AuthenticatedRequest =
  | { ok: false; response: NextResponse }
  | { ok: true; supabase: SupabaseClient; user: User };

async function authenticate(
  request: NextRequest
): Promise<AuthenticatedRequest> {
  const auth = await authenticateApiRequest(request);
  if (auth.error || !auth.user || !auth.supabase) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: auth.error || 'Unauthorized' },
        { status: 401 }
      ),
    };
  }
  return { ok: true, supabase: auth.supabase, user: auth.user };
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const authenticated = await authenticate(request);
  if (!authenticated.ok) return authenticated.response;

  const query = customerSavingsNotificationsQuerySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams.entries())
  );
  if (!query.success) return invalidInput(query.error.flatten());

  try {
    const resolved = await resolveCustomerSavingsContext({
      identifiers: query.data,
      supabase: authenticated.supabase,
      user: authenticated.user,
    });
    if ('response' in resolved) return resolved.response;

    const { data, error } = await resolved.supabase.rpc(
      'get_customer_savings_notifications',
      { p_merchant_id: resolved.merchant.id }
    );
    if (error) throw error;

    const parsed = customerSavingsNotificationsResponseSchema.safeParse(data);
    if (!parsed.success)
      throw new Error('Invalid savings notifications payload');
    const response = customerSavingsNotificationsApiResponseSchema.safeParse({
      ...parsed.data,
      deliveryEnabled:
        process.env.SAVINGS_NOTIFICATIONS_DELIVERY_ENABLED === 'true',
    });
    if (!response.success)
      throw new Error('Invalid savings notifications API response');
    return NextResponse.json(response.data);
  } catch {
    console.error('Customer savings notifications GET failed');
    return unavailable();
  }
}

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  const authenticated = await authenticate(request);
  if (!authenticated.ok) return authenticated.response;

  const csrf = await checkCsrfProtection(request);
  if (!csrf.valid) {
    return (
      csrf.response ??
      NextResponse.json({ error: 'CSRF validation failed' }, { status: 403 })
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Malformed JSON' }, { status: 400 });
  }
  const input = customerSavingsNotificationsUpdateRequestSchema.safeParse(body);
  if (!input.success) return invalidInput(input.error.flatten());

  try {
    const resolved = await resolveCustomerSavingsContext({
      identifiers: { merchantId: input.data.merchantId },
      supabase: authenticated.supabase,
      user: authenticated.user,
    });
    if ('response' in resolved) return resolved.response;

    if (input.data.preferences) {
      const { data, error } = await resolved.supabase.rpc(
        'update_customer_savings_notification_preferences',
        {
          p_merchant_id: resolved.merchant.id,
          p_preferences: input.data.preferences,
        }
      );
      if (error) throw error;
      if (
        !customerSavingsNotificationPreferencesSchema.safeParse(data).success
      ) {
        throw new Error('Invalid savings notification preferences payload');
      }
      return NextResponse.json({ success: true });
    }

    const { data, error } = await resolved.supabase.rpc(
      'mark_customer_savings_notification_read',
      {
        p_merchant_id: resolved.merchant.id,
        p_notification_id: input.data.readNotificationId,
      }
    );
    if (error) throw error;
    if (data === false) {
      return NextResponse.json(
        { error: 'Notification not found' },
        { status: 404 }
      );
    }
    if (data !== true) throw new Error('Invalid notification read result');
    return NextResponse.json({ success: true });
  } catch {
    console.error('Customer savings notifications PATCH failed');
    return unavailable();
  }
}
