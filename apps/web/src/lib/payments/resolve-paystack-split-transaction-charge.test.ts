import { describe, expect, it, vi } from 'vitest';
import { resolvePaystackSplitTransactionCharge } from './resolve-paystack-split-transaction-charge';

const ORDER_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const MERCHANT_ID = '6b5cb8a4-5575-456c-b936-8cdfae30db74';

function clientReturning(result: { data: unknown; error: unknown }) {
  return { rpc: vi.fn().mockResolvedValue(result) };
}

function resolve(
  client: ReturnType<typeof clientReturning>,
  overrides: { amountKobo?: number; platformFeeKobo?: number } = {}
) {
  return resolvePaystackSplitTransactionCharge({
    client,
    customerEmail: 'buyer@example.com',
    orderId: ORDER_ID,
    merchantId: MERCHANT_ID,
    amountKobo: overrides.amountKobo ?? 500_000,
    platformFeeKobo: overrides.platformFeeKobo ?? 7_500,
  });
}

describe('resolvePaystackSplitTransactionCharge', () => {
  it('calls the proof-bound retained-shipping RPC with the order, merchant and customer email', async () => {
    const client = clientReturning({ data: 0, error: null });

    await resolve(client);

    expect(client.rpc).toHaveBeenCalledWith(
      'get_order_paystack_split_retained_shipping_kobo',
      {
        p_email: 'buyer@example.com',
        p_merchant_id: MERCHANT_ID,
        p_order_id: ORDER_ID,
      }
    );
  });

  it('charges only the platform fee when no shipping is retained', async () => {
    const result = await resolve(clientReturning({ data: 0, error: null }));

    expect(result).toEqual({
      transactionChargeKobo: 7_500,
      retainedShippingKobo: 0,
    });
  });

  it('adds the customer-paid GIG delivery fee to the platform fee', async () => {
    const result = await resolve(
      clientReturning({ data: 250_000, error: null })
    );

    expect(result).toEqual({
      transactionChargeKobo: 257_500,
      retainedShippingKobo: 250_000,
    });
  });

  it('clamps retained shipping so the charge never exceeds the payable amount', async () => {
    const result = await resolve(
      clientReturning({ data: 9_999_999, error: null })
    );

    expect(result).toEqual({
      transactionChargeKobo: 500_000,
      retainedShippingKobo: 492_500,
    });
  });

  it.each([
    ['an RPC error', { data: null, error: { message: 'boom' } }],
    ['a null result', { data: null, error: null }],
    ['a negative value', { data: -1, error: null }],
    ['a fractional value', { data: 10.5, error: null }],
    ['NaN', { data: Number.NaN, error: null }],
    ['a string value', { data: '1000', error: null }],
  ])('fails closed on %s', async (_label, rpcResult) => {
    await expect(resolve(clientReturning(rpcResult))).rejects.toThrow();
  });

  it.each([
    ['fractional amount', { amountKobo: 100.5 }],
    ['negative platform fee', { platformFeeKobo: -1 }],
    [
      'platform fee above amount',
      { amountKobo: 1_000, platformFeeKobo: 2_000 },
    ],
  ])('rejects invalid inputs: %s', async (_label, overrides) => {
    const client = clientReturning({ data: 0, error: null });

    await expect(resolve(client, overrides)).rejects.toThrow();
    expect(client.rpc).not.toHaveBeenCalled();
  });
});
