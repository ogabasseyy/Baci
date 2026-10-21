// Shared mocks for the storefront discount-validate suites (issues
// #3165, #3696): registers the service-client/logger mocks and
// re-exports POST (same pattern as
// route.order-test-mocks.test-support.ts).
import type { NextRequest } from 'next/server';
import { vi } from 'vitest';

vi.mock('@/lib/supabase/anon', () => ({
  createAnonClient: vi.fn(),
}));

vi.mock('@/lib/loyalty/server-resolver-client', () => ({
  createLoyaltyResolverServiceClient: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

import { createLoyaltyResolverServiceClient } from '@/lib/loyalty/server-resolver-client';
import { createAnonClient } from '@/lib/supabase/anon';

// Dynamic import AFTER the mocks register (never a static re-export:
// the route module must evaluate against the mocked clients).
export const { POST } = await import('./route');

const mockCreateAnonClient = vi.mocked(createAnonClient);
const mockCreateServiceClient = vi.mocked(createLoyaltyResolverServiceClient);

let merchantRow: unknown = null;

export function setMerchantRow(row: unknown): void {
  merchantRow = row;
}

export function mockRpc(
  impl: (fn: string, args: Record<string, unknown>) => unknown,
  errors: { merchant?: unknown; rpc?: Record<string, unknown> } = {}
) {
  const buildClient = () => {
    const rpc = vi.fn(async (fn: string, args: Record<string, unknown>) => ({
      data: errors.rpc?.[fn] ? null : impl(fn, args),
      error: errors.rpc?.[fn] ?? null,
    }));
    const from = vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn(async () => ({
            data: errors.merchant ? null : merchantRow,
            error: errors.merchant ?? null,
          })),
        })),
      })),
    }));
    return { rpc, from };
  };
  // The route splits privilege (issue #3696): merchant RPC + reads on
  // the anon client, the loyalty resolver RPC on the service client.
  // Both fakes share the impl so existing fn-switch assertions hold.
  const anon = buildClient();
  const service = buildClient();
  // The resolver client exists only for the loyalty RPC: fail loudly if
  // table reads ever route through it (CodeRabbit nit on #3719).
  service.from = vi.fn(() => {
    throw new Error(
      'The loyalty resolver service client must not query tables'
    );
  });
  mockCreateAnonClient.mockReturnValue(anon as never);
  mockCreateServiceClient.mockReturnValue(service as never);
  return { rpc: anon.rpc, serviceRpc: service.rpc };
}

export function request(body: unknown): NextRequest {
  return new Request('http://localhost/api/storefront/discount/validate', {
    method: 'POST',
    body: JSON.stringify(body),
  }) as NextRequest;
}

export const MERCHANT_ID = '11111111-1111-4111-8111-111111111111';

export const baseBody = {
  merchant_id: MERCHANT_ID,
  code: 'RDM-ABCDEF12',
  cart_total: 10000,
};

export function loyaltyRow(overrides: Record<string, unknown> = {}) {
  return {
    redemption_id: '22222222-2222-4222-8222-222222222222',
    reward_type: 'discount_fixed',
    reward_value: 1000,
    minimum_order_amount: null,
    expires_at: null,
    used: false,
    issuance_currency: 'NGN',
    max_redemption_percentage: null,
    minimum_known: true,
    reward_name: 'Probe reward',
    ...overrides,
  };
}
