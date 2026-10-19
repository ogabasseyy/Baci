import { describe, expect, it, vi } from 'vitest';
import { failMerchantWalletAssignmentEvent } from './merchant-wallet-assignment-events';

function client(status: string | null) {
  let updates = 0;
  const chain: Record<string, unknown> = {};
  chain.select = () => chain;
  chain.eq = () => chain;
  chain.update = () => {
    updates += 1;
    return chain;
  };
  chain.maybeSingle = vi.fn().mockImplementation(async () => ({
    data: updates
      ? { id: 'request-1', status: 'failed' }
      : status
        ? { id: 'request-1', status }
        : null,
    error: null,
  }));
  return {
    from: vi.fn(() => chain),
    updates: () => updates,
  } as unknown as Parameters<typeof failMerchantWalletAssignmentEvent>[0] & {
    updates: () => number;
  };
}

const payload = (metadata: Record<string, unknown>) => ({
  data: { customer: { metadata } },
});

describe('Paystack merchant-wallet assignment failure events', () => {
  it('transitions a correlated pending request to retryable failed', async () => {
    const supabase = client('pending');

    const result = await failMerchantWalletAssignmentEvent(
      supabase,
      payload({
        source: 'merchant_wallet_funding',
        request_id: 'request-1',
        merchant_id: 'merchant-1',
      })
    );

    expect(result).toEqual({ kind: 'match' });
    expect(supabase.updates()).toBe(1);
  });

  it('keeps fulfilled requests unchanged on an idempotent failure replay', async () => {
    const supabase = client('fulfilled');

    const result = await failMerchantWalletAssignmentEvent(
      supabase,
      payload({
        source: 'merchant_wallet_funding',
        request_id: 'request-1',
        merchant_id: 'merchant-1',
      })
    );

    expect(result).toEqual({ kind: 'match' });
    expect(supabase.updates()).toBe(0);
  });
});
