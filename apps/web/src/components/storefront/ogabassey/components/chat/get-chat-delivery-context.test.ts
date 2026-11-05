import { describe, expect, it } from 'vitest';
import { getChatDeliveryContext } from './get-chat-delivery-context';

describe('getChatDeliveryContext', () => {
  const base = {
    lines: [{ cartItemId: 'line-1', quantity: 1, price: 100 }],
    subtotal: 100,
    hydrated: true,
    routingMode: 'domain',
    merchantId: 'merchant-1',
    merchantSlug: 'shop',
    cartMerchantSlug: 'shop',
    country: 'NG',
    payoutCurrency: 'NGN',
  };

  it('allows eligible NGN domain storefronts with matching cart ownership', () => {
    expect(getChatDeliveryContext(base).eligible).toBe(true);
    expect(getChatDeliveryContext({ ...base, payoutCurrency: undefined }).eligible).toBe(true);
  });

  it('closes an active estimate context when merchant or cart eligibility changes', () => {
    expect(getChatDeliveryContext({ ...base, cartMerchantSlug: 'other-shop' }).eligible).toBe(false);
    expect(getChatDeliveryContext({ ...base, merchantSlug: 'other-shop' }).eligible).toBe(false);
    expect(getChatDeliveryContext({ ...base, cartMerchantSlug: null }).eligible).toBe(false);
    expect(getChatDeliveryContext({ ...base, routingMode: 'path' }).eligible).toBe(false);
    expect(getChatDeliveryContext({ ...base, payoutCurrency: 'USD' }).eligible).toBe(false);
    expect(getChatDeliveryContext({ ...base, country: 'Nigeria' }).eligible).toBe(false);
    expect(getChatDeliveryContext({ ...base, hydrated: false }).eligible).toBe(false);
    expect(getChatDeliveryContext({ ...base, lines: [] }).eligible).toBe(false);
  });

  it('changes the cart key when ownership, routing, or currency changes', () => {
    const baseKey = getChatDeliveryContext(base).cartKey;
    expect(getChatDeliveryContext({ ...base, cartMerchantSlug: 'other-shop' }).cartKey).not.toBe(baseKey);
    expect(getChatDeliveryContext({ ...base, routingMode: 'path' }).cartKey).not.toBe(baseKey);
    expect(getChatDeliveryContext({ ...base, payoutCurrency: 'USD' }).cartKey).not.toBe(baseKey);
  });
});
