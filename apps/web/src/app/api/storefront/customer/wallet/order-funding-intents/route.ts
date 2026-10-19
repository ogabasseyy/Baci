import { type NextRequest, NextResponse } from 'next/server';
import { authenticateApiRequest } from '@/lib/api-auth';
import { checkCsrfProtection } from '@/lib/csrf';
import { logger } from '@/lib/logger';
import { createOrderWalletFundingIntent } from '@/lib/order-wallet-funding-intents';
import { resolveOrderFundingMerchantAndCustomer } from '@/lib/order-wallet-funding-route-context';
import { orderWalletFundingIntentCreateSchema } from '@/schemas/order-wallet-funding-intent';
import { formatIntentResult } from './wallet-order-funding-intent-response';

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const auth = await authenticateApiRequest(request);
    if (auth.error || !auth.user || !auth.supabase) {
      return NextResponse.json(
        { error: auth.error || 'Unauthorized' },
        { status: 401 }
      );
    }

    const { valid: csrfValid, response: csrfResponse } =
      await checkCsrfProtection(request);
    if (!csrfValid) {
      return (
        csrfResponse ??
        NextResponse.json({ error: 'CSRF validation failed' }, { status: 403 })
      );
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { code: 'MALFORMED_JSON', error: 'Malformed JSON' },
        { status: 400 }
      );
    }

    const parsed = orderWalletFundingIntentCreateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { code: 'INVALID_INPUT', error: 'Invalid input' },
        { status: 400 }
      );
    }

    const resolved = await resolveOrderFundingMerchantAndCustomer({
      identifiers: parsed.data,
      supabase: auth.supabase,
      user: auth.user,
    });
    if ('response' in resolved) return resolved.response;

    const result = await createOrderWalletFundingIntent({
      // DVA creation stays in the dedicated funding-account endpoint. This
      // route creates only the order funding intent under the caller's RLS
      // scope through database-owned RPCs.
      consent: undefined,
      customer: resolved.customer,
      merchant: resolved.merchant,
      orderId: parsed.data.orderId,
      supabase: auth.supabase,
    });

    return formatIntentResult(result);
  } catch (error) {
    logger.error({
      error,
      message: 'Failed to create wallet order funding intent',
      route: 'order-funding-intents',
    });
    return NextResponse.json(
      { error: 'Failed to create wallet order funding intent' },
      { status: 500 }
    );
  }
}
