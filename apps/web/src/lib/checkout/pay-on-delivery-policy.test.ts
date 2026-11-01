import { describe, expect, it, vi } from 'vitest';
import { validatePayOnDeliveryPolicy } from './pay-on-delivery-policy';

const input = {
  merchantId: 'merchant-fixture',
  paymentMethod: 'pod',
  checkoutRequestHash: null,
  requestIdempotencyKey: null,
};
const disabled = { data: [{ pay_on_delivery_enabled: false }], error: null };
describe('merchant POD admission', () => {
  it.each([
    'pod',
    'pay_on_delivery',
  ])('rejects disabled %s', async (paymentMethod) => {
    const rpc = vi.fn().mockResolvedValue(disabled);
    expect(
      await validatePayOnDeliveryPolicy({
        ...input,
        paymentMethod,
        client: { rpc },
      })
    ).toMatchObject({
      ok: false,
      status: 403,
      body: { code: 'PAY_ON_DELIVERY_DISABLED' },
    });
    expect(rpc).toHaveBeenCalledWith('get_storefront_payment_settings', {
      p_merchant_id: input.merchantId,
    });
  });
  it('allows enabled POD without probing replay', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{ pay_on_delivery_enabled: true }],
      error: null,
    });
    expect(
      await validatePayOnDeliveryPolicy({ ...input, client: { rpc } })
    ).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledTimes(1);
  });
  it.each([
    { data: [] },
    { data: [{ pay_on_delivery_enabled: null }] },
  ])('denies missing settings %j', async ({ data }) => {
    expect(
      await validatePayOnDeliveryPolicy({
        ...input,
        client: { rpc: vi.fn().mockResolvedValue({ data, error: null }) },
      })
    ).toMatchObject({ ok: false, status: 403 });
  });
  it('skips non-POD methods', async () => {
    const rpc = vi.fn();
    expect(
      await validatePayOnDeliveryPolicy({
        ...input,
        paymentMethod: 'card',
        client: { rpc },
      })
    ).toEqual({ ok: true });
    expect(rpc).not.toHaveBeenCalled();
  });
  it.each([
    true,
    false,
  ])('requires confirmed exact replay after disable: %s', async (hashMatches) => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce(disabled)
      .mockResolvedValueOnce({ data: hashMatches, error: null });
    expect(
      (
        await validatePayOnDeliveryPolicy({
          ...input,
          checkoutRequestHash: 'server-hash',
          requestIdempotencyKey: 'existing-key',
          client: { rpc },
        })
      ).ok
    ).toBe(hashMatches);
    expect(rpc).toHaveBeenLastCalledWith(
      'is_storefront_order_idempotency_hash',
      {
        p_merchant_id: input.merchantId,
        p_checkout_idempotency_key: 'existing-key',
        p_checkout_request_hash: 'server-hash',
      }
    );
  });
  it('does not accept a key without a confirmed hash', async () => {
    const rpc = vi.fn().mockResolvedValue(disabled);
    expect(
      await validatePayOnDeliveryPolicy({
        ...input,
        requestIdempotencyKey: 'new-key',
        client: { rpc },
      })
    ).toMatchObject({ ok: false, status: 403 });
    expect(rpc).toHaveBeenCalledTimes(1);
  });
  it.each(['settings', 'replay'])('safely rejects %s errors', async (stage) => {
    const failure = { data: null, error: { message: 'private detail' } };
    const rpc =
      stage === 'settings'
        ? vi.fn().mockResolvedValue(failure)
        : vi
            .fn()
            .mockResolvedValueOnce(disabled)
            .mockResolvedValueOnce(failure);
    const result = await validatePayOnDeliveryPolicy({
      ...input,
      checkoutRequestHash: 'hash',
      requestIdempotencyKey: 'key',
      client: { rpc },
    });
    expect(result).toMatchObject({
      ok: false,
      status: 503,
      body: { code: 'POD_POLICY_UNAVAILABLE' },
    });
    expect(JSON.stringify(result)).not.toContain('private detail');
  });
});
