import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { getCachedMerchantByDomain } from '@/lib/cached-data';
import { getBankCardOfferCallbackOrigin } from './get-bank-card-offer-callback-origin';

vi.mock('@/lib/cached-data', () => ({ getCachedMerchantByDomain: vi.fn() }));

const resolveDomain = vi.mocked(getCachedMerchantByDomain);
const order = { merchantId: 'merchant-1', merchantSlug: 'ogabassey' };

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_ROOT_DOMAIN', 'usebaci.com');
  resolveDomain.mockReset();
});
afterEach(() => vi.unstubAllEnvs());

it('keeps the shopper on the verified custom storefront host', async () => {
  resolveDomain.mockResolvedValue({ id: order.merchantId } as never);

  await expect(
    getBankCardOfferCallbackOrigin({
      ...order,
      request: new Request(
        'https://www.ogabassey.example/api/payments/initialize'
      ),
    })
  ).resolves.toBe('https://www.ogabassey.example');
  expect(resolveDomain).toHaveBeenCalledExactlyOnceWith('ogabassey.example');
});

it('uses the canonical storefront for an unknown or cross-merchant hostname', async () => {
  resolveDomain.mockResolvedValue({ id: 'another-merchant' } as never);

  await expect(
    getBankCardOfferCallbackOrigin({
      ...order,
      request: new Request('https://other.example/api/payments/initialize'),
    })
  ).resolves.toBe('https://ogabassey.usebaci.com');
});

it('preserves the configured localhost callback for development', async () => {
  vi.stubEnv('NEXT_PUBLIC_ROOT_DOMAIN', 'localhost:3476');

  await expect(getBankCardOfferCallbackOrigin(order)).resolves.toBe(
    'http://ogabassey.localhost:3476'
  );
  expect(resolveDomain).not.toHaveBeenCalled();
});

it('falls back to the canonical storefront during a domain lookup error', async () => {
  resolveDomain.mockRejectedValue(new Error('domain lookup unavailable'));

  await expect(
    getBankCardOfferCallbackOrigin({
      ...order,
      request: new Request('https://ogabassey.example/api/payments/initialize'),
    })
  ).resolves.toBe('https://ogabassey.usebaci.com');
});

it.each([
  'usebaci.com',
  'www.usebaci.com',
])('preserves the cookie host and merchant path on %s', async (host) => {
  await expect(
    getBankCardOfferCallbackOrigin({
      ...order,
      request: new Request(`https://${host}/api/payments/initialize`),
    })
  ).resolves.toBe(`https://${host}/${order.merchantSlug}`);
  expect(resolveDomain).not.toHaveBeenCalled();
});
