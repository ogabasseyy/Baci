import { vi } from 'vitest';

export const leg = (over: Record<string, unknown> = {}) => ({
  amount: 5000,
  currency: 'NGN',
  gateway: 'paystack',
  gateway_reference: 'ref',
  id: 'leg-1',
  payment_transaction_id: null,
  status: 'completed',
  transaction_type: 'payment',
  ...over,
});

export function supabaseWith({
  evidence = { data: false, error: null } as unknown,
  ledger = { data: [leg()], error: null } as unknown,
  mode = {
    data: {
      amount_paid: 5000,
      cancellation_refund_mode: 'automatic',
      currency: 'NGN',
    },
    error: null,
  },
}: {
  evidence?: unknown;
  ledger?: unknown;
  mode?: unknown;
} = {}) {
  const chain: Record<string, unknown> = {};
  chain.eq = vi.fn(() => chain);
  chain.in = vi.fn().mockResolvedValue(ledger);
  return {
    rpc: vi.fn().mockResolvedValue(evidence),
    from: vi.fn((table: string) =>
      table === 'orders'
        ? {
            select: () => ({
              eq: () => ({
                eq: () => ({ maybeSingle: vi.fn().mockResolvedValue(mode) }),
              }),
            }),
          }
        : { select: () => chain }
    ),
  } as never;
}

export const base = { merchantId: 'm1', orderId: 'o1' };
export const manual = {
  ...base,
  alreadyCancelled: false,
  requested: 'manual' as const,
};
