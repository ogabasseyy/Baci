import { AppState } from 'react-native';
import {
  type CartReceiveAccess,
  type CartReceiveConnection,
  startSharedCartRealtime,
} from './shared-cart-realtime';

jest.mock('react-native', () => ({
  AppState: { currentState: 'active', addEventListener: jest.fn() },
}));

const MERCHANT = '11111111-1111-4111-8111-111111111111';
const CART = '22222222-2222-4222-8222-222222222222';
let appStateListener: ((state: string) => void) | undefined;

function access(ttlMs = 300000): CartReceiveAccess {
  return {
    topic: `cart:${MERCHANT}:${CART}`,
    token: 'receive-token',
    expiresAt: new Date(Date.now() + ttlMs).toISOString(),
  };
}
function event(version: number, cartId = CART) {
  return {
    merchantId: MERCHANT,
    cartId,
    version,
    operationId: `op-${version}`,
  };
}
async function flush() {
  for (let i = 0; i < 40; i += 1) await Promise.resolve();
}
function setup(
  overrides: {
    cartId?: string | null;
    version?: number;
    access?: CartReceiveAccess;
  } = {}
) {
  let onEvent: (value: unknown) => void = () => undefined;
  let onStatus: (joined: boolean) => void = () => undefined;
  const disconnect = jest.fn().mockResolvedValue(undefined);
  const connection: CartReceiveConnection = { disconnect };
  const deps = {
    loadAccess: jest.fn(async () => overrides.access ?? access()),
    connect: jest.fn(async (_a, e, s) => {
      onEvent = e;
      onStatus = s;
      return connection;
    }),
  };
  const state = {
    cartId: overrides.cartId === undefined ? CART : overrides.cartId,
    version: overrides.version ?? 3,
    current: true,
  };
  const refresh = jest.fn().mockResolvedValue(undefined);
  const handle = startSharedCartRealtime(
    {
      merchantId: MERCHANT,
      getCartId: () => state.cartId,
      getVersion: () => state.version,
      isCurrent: () => state.current,
      refresh,
    },
    deps
  );
  return {
    deps,
    disconnect,
    handle,
    refresh,
    state,
    emit: (value: unknown) => onEvent(value),
    join: (joined: boolean) => onStatus(joined),
  };
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  (AppState as { currentState: string }).currentState = 'active';
  (AppState.addEventListener as jest.Mock).mockImplementation(
    (_e: string, cb: (state: string) => void) => {
      appStateListener = cb;
      return { remove: jest.fn() };
    }
  );
});
afterEach(() => jest.useRealTimers());

it('subscribes to the cart topic and refreshes on a newer version', async () => {
  const t = setup();
  await flush();
  expect(t.deps.connect).toHaveBeenCalledTimes(1);
  t.emit(event(4));
  await flush();
  expect(t.refresh).toHaveBeenCalledTimes(1);
  t.handle.stop();
});

it('ignores stale, malformed and foreign-cart broadcasts', async () => {
  const t = setup();
  await flush();
  t.emit(event(3));
  t.emit({ nonsense: true });
  t.emit(event(9, '33333333-3333-4333-8333-333333333333'));
  await flush();
  expect(t.refresh).not.toHaveBeenCalled();
  t.handle.stop();
});

it('does not connect without a cart and connects once sync sees one', async () => {
  const t = setup({ cartId: null });
  await flush();
  expect(t.deps.loadAccess).not.toHaveBeenCalled();
  t.state.cartId = CART;
  t.handle.sync();
  await flush();
  expect(t.deps.connect).toHaveBeenCalledTimes(1);
  t.handle.stop();
});

it('refreshes after joining so a missed broadcast is recovered', async () => {
  const t = setup();
  await flush();
  t.join(true);
  await flush();
  expect(t.refresh).toHaveBeenCalledTimes(1);
  t.handle.stop();
});

it('rejects an access grant for another topic', async () => {
  const t = setup({
    access: { ...access(), topic: `cart:${MERCHANT}:other` },
  });
  await flush();
  expect(t.deps.connect).not.toHaveBeenCalled();
  t.handle.stop();
});

it('disconnects when the app is backgrounded and reconnects in the foreground', async () => {
  const t = setup();
  await flush();
  appStateListener?.('background');
  await flush();
  expect(t.disconnect).toHaveBeenCalledTimes(1);
  appStateListener?.('active');
  await flush();
  expect(t.deps.connect).toHaveBeenCalledTimes(2);
  t.handle.stop();
});

it('renews the receive token before it expires', async () => {
  const t = setup();
  await flush();
  jest.advanceTimersByTime(300000);
  await flush();
  expect(t.deps.connect).toHaveBeenCalledTimes(2);
  expect(t.disconnect).toHaveBeenCalledTimes(1);
  t.handle.stop();
});

it('retries quietly after a failed connection and never throws', async () => {
  const t = setup();
  t.deps.loadAccess.mockRejectedValueOnce(new Error('offline'));
  t.handle.sync();
  await flush();
  jest.advanceTimersByTime(15000);
  await flush();
  expect(t.deps.connect).toHaveBeenCalled();
  t.handle.stop();
});

it('tears down on stop and ignores late events and sessions that changed', async () => {
  const t = setup();
  await flush();
  t.state.current = false;
  t.emit(event(9));
  await flush();
  expect(t.refresh).not.toHaveBeenCalled();
  t.state.current = true;
  t.handle.stop();
  await flush();
  expect(t.disconnect).toHaveBeenCalled();
  t.emit(event(10));
  await flush();
  expect(t.refresh).not.toHaveBeenCalled();
});

it('keeps a single socket when connects overlap', async () => {
  const t = setup({ cartId: null });
  const grants: Array<(value: CartReceiveAccess) => void> = [];
  t.deps.loadAccess.mockImplementation(
    () => new Promise<CartReceiveAccess>((resolve) => grants.push(resolve))
  );
  t.state.cartId = CART;
  t.handle.sync();
  t.handle.sync();
  await flush();
  for (const grant of grants.splice(0)) grant(access());
  await flush();
  expect(t.deps.connect).toHaveBeenCalledTimes(1);
  t.handle.stop();
});

it('retries a hint at the same version after a failed refresh', async () => {
  const t = setup();
  await flush();
  t.refresh.mockRejectedValueOnce(new Error('offline'));
  t.emit(event(4));
  await flush();
  t.emit(event(4));
  await flush();
  expect(t.refresh).toHaveBeenCalledTimes(2);
  t.emit(event(4));
  await flush();
  expect(t.refresh).toHaveBeenCalledTimes(2);
  t.handle.stop();
});

it('does not carry a finished refresh hint into a different cart', async () => {
  const t = setup();
  await flush();
  let done: () => void = () => undefined;
  t.refresh.mockImplementationOnce(
    () => new Promise<void>((resolve) => (done = resolve))
  );
  t.emit(event(100));
  await flush();
  t.state.cartId = '33333333-3333-4333-8333-333333333333';
  t.state.version = 1;
  done();
  await flush();
  expect(t.refresh).toHaveBeenCalledTimes(1);
  t.handle.stop();
});

it('accepts a grant whose topic differs only by case', async () => {
  const t = setup({
    access: { ...access(), topic: `cart:${MERCHANT.toUpperCase()}:${CART}` },
  });
  await flush();
  expect(t.deps.connect).toHaveBeenCalledTimes(1);
  t.handle.stop();
});

it('keeps one refresh in flight and folds a burst into one follow-up', async () => {
  const t = setup();
  await flush();
  let done: () => void = () => undefined;
  t.refresh.mockImplementationOnce(
    () => new Promise<void>((resolve) => (done = resolve))
  );
  for (const version of [4, 5, 6, 7, 8]) t.emit(event(version));
  await flush();
  expect(t.refresh).toHaveBeenCalledTimes(1);
  done();
  await flush();
  expect(t.refresh).toHaveBeenCalledTimes(2);
  t.handle.stop();
});

it('skips the follow-up when the first refresh already reached the newest version', async () => {
  const t = setup();
  await flush();
  let done: () => void = () => undefined;
  t.refresh.mockImplementationOnce(() => {
    t.state.version = 8;
    return new Promise<void>((resolve) => (done = resolve));
  });
  t.emit(event(4));
  t.emit(event(8));
  await flush();
  done();
  await flush();
  expect(t.refresh).toHaveBeenCalledTimes(1);
  t.handle.stop();
});

it('drops hints queued for a cart the shopper has since left', async () => {
  const t = setup();
  await flush();
  let done: () => void = () => undefined;
  t.refresh.mockImplementationOnce(
    () => new Promise<void>((resolve) => (done = resolve))
  );
  t.emit(event(100));
  t.emit(event(101));
  await flush();
  t.state.cartId = '33333333-3333-4333-8333-333333333333';
  t.state.version = 1;
  t.handle.sync();
  done();
  await flush();
  expect(t.refresh).toHaveBeenCalledTimes(1);
  t.handle.stop();
});
