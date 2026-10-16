import { nativeCartAccountsEnabled, nativeCartEnabled } from './enrollment';

it('requires explicit shared and native enrollment plus the configured merchant identity', () => {
  const merchant = {
    id: 'a',
    slug: 'alpha',
    premium_features: ['shared_cart', 'shared_cart_native'],
  };
  expect(
    nativeCartEnabled(merchant, { merchantId: 'a', merchantSlug: 'alpha' })
  ).toBe(true);
  expect(
    nativeCartEnabled(merchant, { merchantId: 'b', merchantSlug: 'beta' })
  ).toBe(false);
  expect(
    nativeCartEnabled(
      { ...merchant, premium_features: ['all_features'] },
      { merchantId: 'a', merchantSlug: 'alpha' }
    )
  ).toBe(false);
  expect(
    nativeCartEnabled(merchant, { merchantId: '', merchantSlug: 'alpha' })
  ).toBe(false);
});

it('matches stored feature values with web-style normalization', () => {
  const merchant = {
    id: 'a',
    slug: 'alpha',
    premium_features: [' Shared_Cart ', 'SHARED_CART_NATIVE'],
  };
  expect(
    nativeCartEnabled(merchant, { merchantId: 'a', merchantSlug: 'alpha' })
  ).toBe(true);
});

it('requires the separate accounts enrollment for account linking', () => {
  const merchant = {
    id: 'a',
    slug: 'alpha',
    premium_features: ['shared_cart', 'shared_cart_native'],
  };
  expect(
    nativeCartAccountsEnabled(merchant, {
      merchantId: 'a',
      merchantSlug: 'alpha',
    })
  ).toBe(false);
  expect(
    nativeCartAccountsEnabled(
      {
        ...merchant,
        premium_features: [
          'shared_cart',
          'shared_cart_native',
          'shared_cart_accounts',
        ],
      },
      { merchantId: 'a', merchantSlug: 'alpha' }
    )
  ).toBe(true);
});
