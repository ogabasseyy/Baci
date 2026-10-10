import { NextRequest } from 'next/server';
import { vi } from 'vitest';
import { primaryWalletCardCheckoutFixture as fixture } from '@/lib/piggyvest/primary-wallet-card-checkout.test-fixture';

export function primaryWalletCardCheckoutRouteFixture(
  action: 'initialize' | 'status'
) {
  const identity = {
    id: fixture.intent.customerId,
    merchant_id: fixture.intent.merchantId,
    user_id: fixture.intent.userId,
    email: fixture.intent.email,
  };
  const query = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: identity, error: null }),
  };
  const auth = {
    user: {
      id: fixture.intent.userId,
      email: fixture.intent.email,
      email_confirmed_at: '2026-10-07T00:00:00Z',
    },
    error: null,
    supabase: { from: vi.fn().mockReturnValue(query) },
  };
  const body =
    action === 'initialize'
      ? {
          merchantId: fixture.intent.merchantId,
          idempotencyKey: fixture.intent.operationId,
          amountKobo: fixture.intent.amountKobo,
          consent: fixture.intent.consent,
        }
      : {
          merchantId: fixture.intent.merchantId,
          operationId: fixture.intent.operationId,
        };
  return {
    auth,
    query,
    body,
    request: (value: unknown = body) =>
      new NextRequest(
        `https://example.test/api/storefront/customer/wallet/primary-card/${action}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(value),
        }
      ),
  };
}
