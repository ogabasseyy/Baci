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

it('rejects non-canonical feature values that SQL containment gates reject', () => {
  const merchant = {
    id: 'a',
    slug: 'alpha',
    premium_features: [' Shared_Cart ', 'SHARED_CART_NATIVE'],
  };
  expect(
    nativeCartEnabled(merchant, { merchantId: 'a', merchantSlug: 'alpha' })
  ).toBe(false);
});

it('ignores non-string feature entries instead of crashing', () => {
  const merchant = {
    id: 'a',
    slug: 'alpha',
    premium_features: [null, 42, 'shared_cart', 'shared_cart_native'] as never,
  };
  expect(
    nativeCartEnabled(merchant, { merchantId: 'a', merchantSlug: 'alpha' })
  ).toBe(true);
  expect(
    nativeCartEnabled(
      { ...merchant, premium_features: [null] as never },
      { merchantId: 'a', merchantSlug: 'alpha' }
    )
  ).toBe(false);
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
  // Non-canonical account-link flags stay disabled to match the SQL gate.
  expect(
    nativeCartAccountsEnabled(
      {
        ...merchant,
        premium_features: [
          'shared_cart',
          'shared_cart_native',
          ' Shared_Cart_Accounts ',
        ],
      },
      { merchantId: 'a', merchantSlug: 'alpha' }
    )
  ).toBe(false);
});
