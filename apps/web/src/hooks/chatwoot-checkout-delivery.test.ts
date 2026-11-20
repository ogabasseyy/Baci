import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type ChatwootCheckoutDeliveryInput,
  resolveChatwootCheckoutDelivery,
  resolveChatwootCheckoutState,
} from './chatwoot-checkout-delivery';
import {
  checkoutPlaceRequest,
  merchantQuote,
  quotes,
  stubCheckoutFetch,
} from './chatwoot-checkout-test-fixtures';

afterEach(() => vi.unstubAllGlobals());

const input = (
  overrides: Partial<ChatwootCheckoutDeliveryInput> = {}
): ChatwootCheckoutDeliveryInput => ({
  merchantId: 'merchant-1',
  customer: checkoutPlaceRequest.customer,
  address: checkoutPlaceRequest.address,
  choice: checkoutPlaceRequest.delivery,
  quoteItems: [{ name: 'Phone', quantity: 2, price: 1000 }],
  cartSubtotal: 2000,
  ...overrides,
});
const stub = (...list: Record<string, unknown>[]) =>
  stubCheckoutFetch({ '/api/shipping/quotes': () => quotes(...list) });

describe('resolveChatwootCheckoutState', () => {
  it('resolves canonical Nigerian state names and rejects others', () => {
    expect(resolveChatwootCheckoutState('lagos')).toBe('Lagos');
    expect(resolveChatwootCheckoutState('FCT')).toBe('Abuja (FCT)');
    expect(resolveChatwootCheckoutState('Atlantis')).toBeNull();
  });
});

describe('resolveChatwootCheckoutDelivery', () => {
  it('matches the single merchant rate and sends the cart subtotal it was given', async () => {
    const { calls } = stub(merchantQuote());

    const result = await resolveChatwootCheckoutDelivery(
      input({ cartSubtotal: 1800 })
    );

    expect(result).toMatchObject({
      ok: true,
      method: 'door',
      merchantRateId: 'rate-1',
    });
    expect(JSON.parse(String(calls[0]?.init.body))).toMatchObject({
      cart_subtotal: 1800,
      merchant_rates_only: true,
    });
  });

  it('asks for the delivery type the shopper chose, merchant rates only', async () => {
    const door = stub(merchantQuote());
    await resolveChatwootCheckoutDelivery(input());
    expect(JSON.parse(String(door.calls[0]?.init.body))).toMatchObject({
      deliveryPreference: 'door',
      merchant_rates_only: true,
    });
    vi.unstubAllGlobals();

    const pickup = stub(merchantQuote());
    await resolveChatwootCheckoutDelivery(
      input({ choice: { ...checkoutPlaceRequest.delivery, pickup: true } })
    );
    expect(JSON.parse(String(pickup.calls[0]?.init.body))).toMatchObject({
      deliveryPreference: 'pickup_station',
      merchant_rates_only: true,
    });
  });

  it('fails for an unknown state without a request', async () => {
    const { fetchMock } = stub(merchantQuote());

    expect(
      await resolveChatwootCheckoutDelivery(
        input({
          address: { ...checkoutPlaceRequest.address, state: 'Atlantis' },
        })
      )
    ).toEqual({ ok: false, code: 'details_invalid' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails when no rate or several rates match', async () => {
    stub(merchantQuote({ displayName: 'Other' }));
    expect(await resolveChatwootCheckoutDelivery(input())).toEqual({
      ok: false,
      code: 'delivery_unavailable',
    });

    stub(merchantQuote(), merchantQuote({ id: 'mrate_rate-2' }));
    expect(await resolveChatwootCheckoutDelivery(input())).toEqual({
      ok: false,
      code: 'delivery_unavailable',
    });
  });

  describe('pickup location identity', () => {
    const pickup = (location: string, id: string) =>
      merchantQuote({
        id: `mrate_${id}`,
        displayName: 'Collect',
        price: 0,
        isStationPickup: true,
        stationName: location,
        stationAddress: 'Road 1',
      });
    const choice = (pickupLocation?: string) => ({
      displayName: 'Collect',
      priceMajor: 0,
      pickup: true,
      ...(pickupLocation ? { pickupLocation } : {}),
    });

    it('selects the rate whose pickup location matches', async () => {
      stub(pickup('Ikeja', 'a'), pickup('Lekki', 'b'));

      const result = await resolveChatwootCheckoutDelivery(
        input({ choice: choice('Lekki · Road 1') })
      );

      expect(result).toMatchObject({
        ok: true,
        merchantRateId: 'b',
        method: 'pickup_station',
      });
    });

    it('stays ambiguous when two same-name rates are asked for without a location', async () => {
      stub(pickup('Ikeja', 'a'), pickup('Lekki', 'b'));

      expect(
        await resolveChatwootCheckoutDelivery(input({ choice: choice() }))
      ).toEqual({
        ok: false,
        code: 'delivery_unavailable',
      });
    });

    it('accepts the only pickup rate when the widget sends no location', async () => {
      stub(pickup('Ikeja', 'a'));

      expect(
        await resolveChatwootCheckoutDelivery(input({ choice: choice() }))
      ).toMatchObject({
        ok: true,
        merchantRateId: 'a',
        method: 'pickup_station',
      });
    });

    it('refuses a location no rate has', async () => {
      stub(pickup('Ikeja', 'a'));

      expect(
        await resolveChatwootCheckoutDelivery(
          input({ choice: choice('Elsewhere') })
        )
      ).toEqual({ ok: false, code: 'delivery_unavailable' });
    });

    it('does not require a location for a door choice', async () => {
      stub(merchantQuote());

      expect(await resolveChatwootCheckoutDelivery(input())).toMatchObject({
        ok: true,
        method: 'door',
      });
    });
  });
});
