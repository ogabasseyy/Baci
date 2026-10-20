import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  baseBody,
  loyaltyRow,
  mockRpc,
  POST,
  request,
  setMerchantRow,
} from './route.test-support';

describe('POST /api/storefront/discount/validate loyalty fallback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setMerchantRow(null);
  });

  it('validates a bridgeable loyalty code after a merchant miss', async () => {
    mockRpc((fn) =>
      fn === 'get_storefront_discount_code' ? [] : [loyaltyRow()]
    );

    const response = await POST(request(baseBody));
    const body = await response.json();

    expect(body).toMatchObject({
      valid: true,
      code: 'RDM-ABCDEF12',
      discount_type: 'fixed',
      discount_value: 1000,
      discount_amount: 1000,
      description: 'Probe reward',
    });
    expect(body.discount_code_id).toBeNull();
    // The internal redemption UUID stays server-side: the order route
    // re-resolves the public code, so anon callers get no row handle.
    expect(body.loyalty_redemption_id).toBeUndefined();
  });
  it('returns invalid when neither lookup resolves', async () => {
    mockRpc(() => []);

    const response = await POST(request(baseBody));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ valid: false, error: 'Invalid discount code' });
  });
  it('previews an already-used loyalty code for checkout replay', async () => {
    // After a reload the shopper re-enters the code: the preview
    // reconstructs the applied discount so the persisted checkout key
    // reaches the replay-aware order wrapper, which decides replay
    // vs already-used authoritatively.
    mockRpc((fn) =>
      fn === 'get_storefront_discount_code' ? [] : [loyaltyRow({ used: true })]
    );

    const body = await (await POST(request(baseBody))).json();

    expect(body.valid).toBe(true);
    expect(body.discount_code_id).toBeNull();
  });
  it('rejects a non-discount loyalty type as invalid', async () => {
    mockRpc((fn) =>
      fn === 'get_storefront_discount_code'
        ? []
        : [loyaltyRow({ reward_type: 'free_shipping', reward_value: null })]
    );

    const body = await (await POST(request(baseBody))).json();

    expect(body).toEqual({ valid: false, error: 'Invalid discount code' });
  });
  it('enforces the loyalty minimum against the cart total', async () => {
    mockRpc((fn) =>
      fn === 'get_storefront_discount_code'
        ? []
        : [
            loyaltyRow({
              minimum_order_amount: 50000,
              issuance_currency: 'USD',
            }),
          ]
    );

    const body = await (
      await POST(request({ ...baseBody, cart_total: 10000 }))
    ).json();

    expect(body.valid).toBe(false);
    expect(body.error).toContain('Minimum purchase of');
  });
  it('collapses an expired loyalty code to generic invalid', async () => {
    mockRpc((fn) =>
      fn === 'get_storefront_discount_code'
        ? []
        : [loyaltyRow({ expires_at: '2020-01-01T00:00:00.000Z' })]
    );

    const body = await (await POST(request(baseBody))).json();

    expect(body).toEqual({ valid: false, error: 'Invalid discount code' });
  });
  it('returns 500 when the loyalty lookup errors', async () => {
    // Merchant lookup succeeds on the anon client; only the
    // service-client loyalty call fails: the 500 must come from the
    // lookupErrorResponse branch, not a missing client.
    mockRpc(() => [], {
      rpc: { get_loyalty_redemption_for_checkout: { message: 'boom' } },
    });

    const response = await POST(request(baseBody));
    const body = await response.json();

    // A failed lookup is a retryable 500, not an invalid code: holders
    // must not be told an issued code is invalid during an outage.
    expect(response.status).toBe(500);
    expect(body).toEqual({ valid: false, error: 'Internal server error' });
  });
  it('validates a code whose reward was later disabled', async () => {
    // Snapshot-governed: the resolver selects no live reward state, so
    // validate cannot see a later disable and the paid code validates.
    mockRpc((fn) =>
      fn === 'get_storefront_discount_code' ? [] : [loyaltyRow()]
    );

    const body = await (await POST(request(baseBody))).json();

    expect(body).toMatchObject({ valid: true, code: 'RDM-ABCDEF12' });
  });
  it('bridges a plain discount code with fixed semantics', async () => {
    mockRpc((fn) =>
      fn === 'get_storefront_discount_code'
        ? []
        : [loyaltyRow({ reward_type: 'discount', reward_value: 1500 })]
    );

    const body = await (await POST(request(baseBody))).json();

    expect(body).toMatchObject({
      valid: true,
      discount_type: 'fixed',
      discount_value: 1500,
      discount_amount: 1500,
    });
  });
  it('formats the loyalty minimum in the merchant currency', async () => {
    setMerchantRow({ country: 'US', payout_currency: 'USD' });
    mockRpc((fn) =>
      fn === 'get_storefront_discount_code'
        ? []
        : [
            loyaltyRow({
              minimum_order_amount: 50000,
              issuance_currency: 'USD',
            }),
          ]
    );

    const body = await (
      await POST(request({ ...baseBody, cart_total: 10000 }))
    ).json();

    expect(body.valid).toBe(false);
    expect(body.error).toContain('Minimum purchase of');
    expect(body.error).toContain('$');
    expect(body.error).not.toContain('₦');
  });
  it('keeps the minimum label currency-neutral on lookup failure', async () => {
    mockRpc(
      (fn) =>
        fn === 'get_storefront_discount_code'
          ? []
          : [
              loyaltyRow({
                minimum_order_amount: 50000,
                issuance_currency: 'USD',
              }),
            ],
      { merchant: { message: 'db down' } }
    );

    const body = await (
      await POST(request({ ...baseBody, cart_total: 10000 }))
    ).json();

    expect(body.valid).toBe(false);
    expect(body.error).toBe('Minimum purchase of 50,000 required');
    expect(body.error).not.toMatch(/₦|₹|\$/);
  });
});
