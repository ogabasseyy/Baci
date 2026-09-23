import { beforeEach, describe, expect, it, vi } from 'vitest';
import { persistMerchantWalletAssignmentEvent } from '@/lib/persist-merchant-wallet-assignment-event';

function supabase(
  error: Error | null = null,
  options: {
    existing?: Record<string, unknown> | null;
    requestRows?: Record<string, unknown>[];
  } = {}
) {
  const rpc = vi.fn().mockResolvedValue({ data: null, error });
  const requestRows = options.requestRows ?? [
    { id: 'req-1', merchant_id: 'm-1', status: 'pending' },
  ];
  const requestQuery: Record<string, unknown> = {};
  requestQuery.select = vi.fn(() => requestQuery);
  requestQuery.eq = vi.fn(() => requestQuery);
  requestQuery.in = vi.fn(() => requestQuery);
  // biome-ignore lint/suspicious/noThenProperty: Supabase query mocks are thenable.
  requestQuery.then = (resolve: (value: unknown) => unknown) =>
    resolve({ data: requestRows, error: null });
  const accountQuery: Record<string, unknown> = {};
  accountQuery.select = vi.fn(() => accountQuery);
  accountQuery.eq = vi.fn(() => accountQuery);
  accountQuery.maybeSingle = vi.fn().mockResolvedValue({
    data: options.existing ?? null,
    error: null,
  });
  return {
    from: vi.fn((table: string) =>
      table === 'merchant_wallet_funding_account_requests'
        ? requestQuery
        : accountQuery
    ),
    rpc,
  } as unknown as Parameters<typeof persistMerchantWalletAssignmentEvent>[0] & {
    rpc: typeof rpc;
  };
}
const valid = (overrides: Record<string, unknown> = {}) => ({
  data: {
    metadata: {
      source: 'merchant_wallet_funding',
      request_id: 'req-1',
      merchant_id: 'm-1',
    },
    account_number: '1234567890',
    account_name: 'Merchant',
    currency: 'NGN',
    bank: { name: 'Bank' },
    ...overrides,
  },
});
describe('verified Paystack merchant-wallet assignment events', () => {
  beforeEach(() => vi.restoreAllMocks());
  it('ignores missing payload data without wallet source', async () => {
    expect(
      (await persistMerchantWalletAssignmentEvent(supabase(), {})).kind
    ).toBe('ignored');
  });
  it('ignores unknown source metadata', async () => {
    expect(
      (
        await persistMerchantWalletAssignmentEvent(
          supabase(),
          valid({
            metadata: {
              source: 'order_dva',
              request_id: 'r',
              merchant_id: 'm',
            },
          })
        )
      ).kind
    ).toBe('ignored');
  });
  it('reviews absent request correlation', async () => {
    expect(
      (
        await persistMerchantWalletAssignmentEvent(
          supabase(),
          valid({
            metadata: { source: 'merchant_wallet_funding', merchant_id: 'm' },
          })
        )
      ).kind
    ).toBe('review');
  });
  it('reviews absent merchant correlation', async () => {
    expect(
      (
        await persistMerchantWalletAssignmentEvent(
          supabase(),
          valid({
            metadata: { source: 'merchant_wallet_funding', request_id: 'r' },
          })
        )
      ).kind
    ).toBe('review');
  });
  it('reviews non-NGN accounts', async () => {
    expect(
      (
        await persistMerchantWalletAssignmentEvent(
          supabase(),
          valid({ currency: 'USD' })
        )
      ).kind
    ).toBe('review');
  });
  it('reviews malformed account numbers', async () => {
    expect(
      (
        await persistMerchantWalletAssignmentEvent(
          supabase(),
          valid({ account_number: 'ABC' })
        )
      ).kind
    ).toBe('review');
  });
  it('persists valid assignments through the service RPC seam', async () => {
    const s = supabase();
    expect((await persistMerchantWalletAssignmentEvent(s, valid())).kind).toBe(
      'match'
    );
    expect(s.rpc).toHaveBeenCalledWith(
      'persist_merchant_wallet_payment_account',
      expect.objectContaining({
        p_request_id: 'req-1',
        p_merchant_id: 'm-1',
        p_currency: 'NGN',
      })
    );
  });
  it('accepts Paystack customer metadata when assignment metadata is nested', async () => {
    const s = supabase();
    const payload = {
      data: {
        customer: {
          customer_code: 'CUS_merchant',
          metadata: {
            source: 'merchant_wallet_funding',
            request_id: 'req-1',
            merchant_id: 'm-1',
          },
        },
        dedicated_account: {
          account_number: '1234567890',
          account_name: 'Merchant',
          currency: 'NGN',
          assigned: true,
          active: true,
          bank: { name: 'Bank' },
        },
      },
    };

    const result = await persistMerchantWalletAssignmentEvent(s, payload);
    expect(result.kind).toBe('match');
    expect(s.rpc).toHaveBeenCalledWith(
      'persist_merchant_wallet_payment_account',
      expect.objectContaining({
        p_provider_customer_code: 'CUS_merchant',
      })
    );
  });
  it('always invokes persistence for valid duplicate-shaped events', async () => {
    const s = supabase();
    await persistMerchantWalletAssignmentEvent(s, valid({ id: 'same' }));
    await persistMerchantWalletAssignmentEvent(s, valid({ id: 'same' }));
    expect(s.rpc).toHaveBeenCalledTimes(2);
  });
  it('maps persistence conflicts or provider errors to review', async () => {
    expect(
      (
        await persistMerchantWalletAssignmentEvent(
          supabase(new Error('conflict')),
          valid()
        )
      ).kind
    ).toBe('review');
  });
  it('does not expose provider account payload in its result', async () => {
    const result = await persistMerchantWalletAssignmentEvent(
      supabase(),
      valid({ account_number: '1234567890', account_name: 'Secret' })
    );
    expect(result).toEqual({ kind: 'match' });
  });
});
