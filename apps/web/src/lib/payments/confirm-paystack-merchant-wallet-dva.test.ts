import { beforeEach, describe, expect, it, vi } from 'vitest';

const { alias, settled } = vi.hoisted(() => ({
  alias: vi.fn(),
  settled: vi.fn(),
}));
vi.mock('@/lib/payments/paystack-dva-order-alias', () => ({
  hasActivePaystackOrderDvaAlias: alias,
}));
vi.mock('@/lib/payments/has-settled-paystack-order-payment-reference', () => ({
  hasSettledPaystackOrderPaymentReference: settled,
}));

import { confirmPaystackMerchantWalletDva } from './confirm-paystack-merchant-wallet-dva';

function client(
  rows: unknown[],
  rpcResult: { data: unknown; error: Error | null } = {
    data: [{ new_balance: 1500, first_credit: true }],
    error: null,
  }
) {
  const rpc = vi.fn().mockResolvedValue(rpcResult);
  const chain = {
    insert: vi.fn().mockResolvedValue({ data: null, error: null }),
    select: () => chain,
    eq: () => chain,
    // biome-ignore lint/suspicious/noThenProperty: Supabase query mocks are thenable.
    then: (resolve: (v: unknown) => unknown) =>
      resolve({ data: rows, error: null }),
  };
  return {
    from: () => chain,
    rpc,
    insert: chain.insert,
  } as unknown as Parameters<
    typeof confirmPaystackMerchantWalletDva
  >[0]['supabase'] & { insert: typeof chain.insert; rpc: typeof rpc };
}
const input = (
  supabase: Parameters<typeof confirmPaystackMerchantWalletDva>[0]['supabase'],
  extra: Partial<Parameters<typeof confirmPaystackMerchantWalletDva>[0]> = {}
) => ({
  supabase,
  accountNumber: '1234567890',
  gatewayReference: 'R1',
  verifiedAmount: { amount: 1500, currency: 'NGN' },
  paystackResponse: { authorization: { channel: 'dedicated_nuban' } },
  ...extra,
});
describe('verified merchant-wallet DVA credit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    alias.mockResolvedValue(false);
    settled.mockResolvedValue(false);
  });
  it('returns none for missing receiver', async () => {
    const s = client([{ merchant_id: 'm' }]);
    expect(
      (
        await confirmPaystackMerchantWalletDva(
          input(s, { accountNumber: null })
        )
      ).kind
    ).toBe('none');
  });
  it('returns none for missing amount or wrong currency', async () => {
    const s = client([{ merchant_id: 'm' }]);
    expect(
      (
        await confirmPaystackMerchantWalletDva(
          input(s, { verifiedAmount: null })
        )
      ).kind
    ).toBe('none');
    expect(
      (
        await confirmPaystackMerchantWalletDva(
          input(s, { verifiedAmount: { amount: 2, currency: 'USD' } })
        )
      ).kind
    ).toBe('none');
  });
  it('returns none for zero or negative amount', async () => {
    const s = client([{ merchant_id: 'm' }]);
    expect(
      (
        await confirmPaystackMerchantWalletDva(
          input(s, { verifiedAmount: { amount: 0, currency: 'NGN' } })
        )
      ).kind
    ).toBe('none');
    expect(
      (
        await confirmPaystackMerchantWalletDva(
          input(s, { verifiedAmount: { amount: -1, currency: 'NGN' } })
        )
      ).kind
    ).toBe('none');
  });
  it('returns none for no active account match', async () => {
    expect(
      (await confirmPaystackMerchantWalletDva(input(client([])))).kind
    ).toBe('none');
  });
  it('returns review for multiple active candidates', async () => {
    const result = await confirmPaystackMerchantWalletDva(
      input(client([{ merchant_id: 'm1' }, { merchant_id: 'm2' }]))
    );
    expect(result).toMatchObject({
      kind: 'review',
      status: 409,
      body: { code: 'MERCHANT_WALLET_DVA_AMBIGUOUS' },
    });
  });
  it('bugfix: acknowledges an order-DVA alias conflict after filing review', async () => {
    alias.mockResolvedValue(true);
    const s = client([{ merchant_id: 'm' }]);
    const result = await confirmPaystackMerchantWalletDva(input(s));
    expect(result).toMatchObject({
      kind: 'review',
      status: 200,
      body: {
        code: 'WALLET_DVA_ORDER_ALIAS_CONFLICT',
        error: expect.stringContaining('Filed for manual reconciliation'),
      },
    });
    expect(s.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        issue_type: 'wallet_dva_order_alias_conflict',
        merchant_id: 'm',
        paystack_ref: 'R1',
      })
    );
    expect(s.rpc).not.toHaveBeenCalled();
  });
  it('acknowledges a previously settled order payment reference after filing review', async () => {
    settled.mockResolvedValue(true);
    const s = client([{ merchant_id: 'm' }]);
    const result = await confirmPaystackMerchantWalletDva(input(s));
    expect(result).toMatchObject({
      kind: 'review',
      status: 200,
      body: { code: 'WALLET_DVA_ORDER_PAYMENT_REPLAY' },
    });
    expect(s.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        issue_type: 'wallet_dva_order_payment_replay',
        paystack_ref: 'R1',
      })
    );
    expect(s.rpc).not.toHaveBeenCalled();
  });
  it('fails the webhook when the alias review cannot be persisted', async () => {
    alias.mockResolvedValue(true);
    const s = client([{ merchant_id: 'm' }]);
    s.insert.mockResolvedValue({
      data: null,
      error: new Error('review insert failed'),
    });

    await expect(confirmPaystackMerchantWalletDva(input(s))).rejects.toThrow(
      'review insert failed'
    );
    expect(s.rpc).not.toHaveBeenCalled();
  });
  it('treats a duplicate alias review as an idempotent retry', async () => {
    alias.mockResolvedValue(true);
    const s = client([{ merchant_id: 'm' }]);
    s.insert.mockResolvedValue({
      data: null,
      error: { code: '23505', message: 'duplicate review' },
    });

    await expect(
      confirmPaystackMerchantWalletDva(input(s))
    ).resolves.toMatchObject({
      body: { code: 'WALLET_DVA_ORDER_ALIAS_CONFLICT' },
      kind: 'review',
      status: 200,
    });
    expect(s.rpc).not.toHaveBeenCalled();
  });
  it('falls back to the current time when paid_at is invalid before alias checks', async () => {
    const s = client([{ merchant_id: 'm' }]);
    const before = Date.now();
    await confirmPaystackMerchantWalletDva(
      input(s, {
        paystackResponse: {
          authorization: { channel: 'dedicated_nuban' },
          paid_at: 'not-a-date',
        },
      })
    );
    const aliasCall = alias.mock.calls.at(-1)?.[0] as { asOf: Date };
    expect(aliasCall.asOf).toBeInstanceOf(Date);
    expect(aliasCall.asOf.getTime()).toBeGreaterThanOrEqual(before);
    expect(Number.isNaN(aliasCall.asOf.getTime())).toBe(false);
  });
  it('returns none when Paystack channel is not dedicated_nuban', async () => {
    const s = client([{ merchant_id: 'm' }]);
    expect(
      (
        await confirmPaystackMerchantWalletDva(
          input(s, {
            paystackResponse: {
              authorization: { channel: 'card' },
            },
          })
        )
      ).kind
    ).toBe('none');
    expect(s.rpc).not.toHaveBeenCalled();
  });

  it('returns none when Paystack authorization channel is missing', async () => {
    const s = client([{ merchant_id: 'm' }]);
    expect(
      (
        await confirmPaystackMerchantWalletDva(
          input(s, { paystackResponse: { authorization: {} } })
        )
      ).kind
    ).toBe('none');
    expect(s.rpc).not.toHaveBeenCalled();
  });

  it('credits exact active account and returns balance', async () => {
    const s = client([{ merchant_id: 'm' }]);
    const result = await confirmPaystackMerchantWalletDva(input(s));
    expect(result).toMatchObject({
      kind: 'match',
      balance: 1500,
      firstCredit: true,
    });
    expect(s.rpc).toHaveBeenCalledWith(
      'credit_merchant_wallet_funding',
      expect.objectContaining({
        p_amount: 1500,
        p_currency: 'NGN',
        p_reference: 'R1',
      })
    );
  });
  it('credits the full excess verified amount', async () => {
    const s = client([{ merchant_id: 'm' }]);
    await confirmPaystackMerchantWalletDva(
      input(s, { verifiedAmount: { amount: 9999, currency: 'NGN' } })
    );
    expect(s.rpc).toHaveBeenCalledWith(
      'credit_merchant_wallet_funding',
      expect.objectContaining({ p_amount: 9999 })
    );
  });
  it('returns a duplicate-safe firstCredit false result', async () => {
    const s = client([{ merchant_id: 'm' }], {
      data: [{ new_balance: 1500, first_credit: false }],
      error: null,
    });
    expect(await confirmPaystackMerchantWalletDva(input(s))).toMatchObject({
      kind: 'match',
      firstCredit: false,
    });
  });
  it('propagates credit RPC errors for webhook review handling', async () => {
    const s = client([{ merchant_id: 'm' }], {
      data: null,
      error: new Error('db secret'),
    });
    await expect(confirmPaystackMerchantWalletDva(input(s))).rejects.toThrow(
      'db secret'
    );
  });
  it('credits a reference once across duplicate confirmation calls', async () => {
    let balance = 0;
    let seen = false;
    const s = client([{ merchant_id: 'm' }]);
    s.rpc.mockImplementation(
      async (_name: string, args: { p_amount: number }) => {
        if (seen)
          return {
            data: [{ new_balance: balance, first_credit: false }],
            error: null,
          };
        seen = true;
        balance += args.p_amount;
        return {
          data: [{ new_balance: balance, first_credit: true }],
          error: null,
        };
      }
    );
    const first = await confirmPaystackMerchantWalletDva(
      input(s, { verifiedAmount: { amount: 9999, currency: 'NGN' } })
    );
    const second = await confirmPaystackMerchantWalletDva(
      input(s, { verifiedAmount: { amount: 9999, currency: 'NGN' } })
    );
    expect(first).toMatchObject({
      kind: 'match',
      balance: 9999,
      firstCredit: true,
    });
    expect(second).toMatchObject({
      kind: 'match',
      balance: 9999,
      firstCredit: false,
    });
    expect(balance).toBe(9999);
    expect(s.rpc).toHaveBeenCalledTimes(2);
  });
});
