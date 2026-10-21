import {
  type CheckoutCartState,
  prepareCartCheckout,
} from './prepare-cart-checkout';

const live = {
  enabled: true,
  status: 'ready',
  metadataReady: false,
  snapshot: null,
  prepare: jest.fn(),
  refresh: jest.fn(),
};
beforeEach(() => jest.clearAllMocks());
it('imports a saved device cart on checkout instead of permanently rejecting no-server-cart readiness', async () => {
  let state: Parameters<typeof prepareCartCheckout>[0] extends () => infer S
    ? S
    : never = { ...live };
  const prepare = jest.fn(async () => {
    state = {
      ...state,
      metadataReady: true,
      snapshot: { state: 'active', lines: [{}] },
    };
  });
  state.prepare = prepare;
  await expect(prepareCartCheckout(() => state)).resolves.toEqual({
    ready: true,
  });
  expect(prepare).toHaveBeenCalledTimes(1);
});
it('rehydrates an existing snapshot before checkout', async () => {
  let state: CheckoutCartState = {
    ...live,
    snapshot: { state: 'active', lines: [{}] },
  };
  state.refresh = jest.fn(async () => {
    state = { ...state, metadataReady: true };
  });
  await expect(prepareCartCheckout(() => state)).resolves.toEqual({
    ready: true,
  });
  expect(state.refresh).toHaveBeenCalledTimes(1);
  expect(state.prepare).not.toHaveBeenCalled();
});
it('does not choose a saved cart or discard device items implicitly', async () => {
  const state = { ...live, status: 'choice_required' };
  await expect(prepareCartCheckout(() => state)).resolves.toEqual({
    ready: false,
    reason: 'choice_required',
  });
  expect(state.prepare).not.toHaveBeenCalled();
});
it('keeps checkout blocked on failure, then allows the same action to retry', async () => {
  const prepare = jest
    .fn()
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValue(undefined);
  let state: CheckoutCartState = { ...live, prepare };
  await expect(prepareCartCheckout(() => state)).resolves.toEqual({
    ready: false,
    reason: 'unavailable',
  });
  prepare.mockImplementation(async () => {
    state = {
      ...state,
      metadataReady: true,
      snapshot: { state: 'active', lines: [{}] },
    };
  });
  await expect(prepareCartCheckout(() => state)).resolves.toEqual({
    ready: true,
  });
});
it('rejects completion after the account or merchant controller changes', async () => {
  let state: CheckoutCartState = { ...live };
  state.prepare = jest.fn(async () => {
    state = {
      ...state,
      prepare: jest.fn(),
      metadataReady: true,
      snapshot: { state: 'active', lines: [{}] },
    };
  });
  await expect(prepareCartCheckout(() => state)).resolves.toEqual({
    ready: false,
    reason: 'session_changed',
  });
});
it('permits legacy checkout without creating a server cart', async () => {
  await expect(
    prepareCartCheckout(() => ({ ...live, enabled: false }))
  ).resolves.toEqual({ ready: true });
  expect(live.prepare).not.toHaveBeenCalled();
});
it('silently fences a rejected operation after controller replacement', async () => {
  let state: CheckoutCartState = { ...live };
  state.prepare = jest.fn(async () => {
    state = { ...state, prepare: jest.fn(), status: 'error' };
    throw new Error('session_changed');
  });
  await expect(prepareCartCheckout(() => state)).resolves.toEqual({
    ready: false,
    reason: 'session_changed',
  });
});
it('retries hydration once when prepare discovers the canonical cart', async () => {
  let state: CheckoutCartState = { ...live };
  state.prepare = jest.fn(async () => {
    state = { ...state, snapshot: { state: 'active', lines: [{}] } };
  });
  state.refresh = jest.fn(async () => {
    state = { ...state, metadataReady: true };
  });
  await expect(prepareCartCheckout(() => state)).resolves.toEqual({
    ready: true,
  });
  expect(state.prepare).toHaveBeenCalledTimes(1);
  expect(state.refresh).toHaveBeenCalledTimes(1);
});
it('withholds checkout when a polling refresh publishes a new cart version mid-preparation', async () => {
  let state: CheckoutCartState = {
    ...live,
    snapshot: { state: 'active', lines: [{}], cartId: 'cart-1', version: 1 },
  };
  state.refresh = jest.fn(async () => {
    state = {
      ...state,
      metadataReady: true,
      snapshot: { state: 'active', lines: [{}], cartId: 'cart-1', version: 2 },
    };
  });
  await expect(prepareCartCheckout(() => state)).resolves.toEqual({
    ready: false,
    reason: 'cart_changed',
  });
});
it('stops after one unsuccessful hydration retry without recreating the cart', async () => {
  let state: CheckoutCartState = { ...live };
  state.prepare = jest.fn(async () => {
    state = { ...state, snapshot: { state: 'active', lines: [{}] } };
  });
  state.refresh = jest.fn().mockResolvedValue(undefined);
  await expect(prepareCartCheckout(() => state)).resolves.toEqual({
    ready: false,
    reason: 'unavailable',
  });
  expect(state.prepare).toHaveBeenCalledTimes(1);
  expect(state.refresh).toHaveBeenCalledTimes(1);
});
