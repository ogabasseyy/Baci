import { sharedCartCheckoutReady } from './checkout-ready';

it('permits legacy checkout but requires a confirmed active hydrated shared cart', () => {
  expect(sharedCartCheckoutReady({ enabled: false })).toBe(true);
  const state = {
    enabled: true,
    status: 'ready',
    metadataReady: true,
    snapshot: { state: 'active', lines: [{}] },
  };
  expect(sharedCartCheckoutReady(state)).toBe(true);
  for (const change of [
    { status: 'pending' },
    { metadataReady: false },
    { snapshot: null },
    { snapshot: { state: 'completed', lines: [{}] } },
  ])
    expect(sharedCartCheckoutReady({ ...state, ...change })).toBe(false);
});
