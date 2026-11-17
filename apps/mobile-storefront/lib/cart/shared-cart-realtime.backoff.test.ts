import {
  type CartReceiveAccess,
  startSharedCartRealtime,
} from './shared-cart-realtime';

jest.mock('react-native', () => ({
  AppState: {
    currentState: 'active',
    addEventListener: jest.fn(() => ({ remove: jest.fn() })),
  },
}));

const MERCHANT = '11111111-1111-4111-8111-111111111111';
const CART = '22222222-2222-4222-8222-222222222222';
const grant = (ttlMs: number): CartReceiveAccess => ({
  topic: `cart:${MERCHANT}:${CART}`,
  token: 't',
  expiresAt: new Date(Date.now() + ttlMs).toISOString(),
});
const flush = async () => {
  for (let i = 0; i < 40; i += 1) await Promise.resolve();
};

function setup(loadAccess: jest.Mock) {
  const connect = jest.fn(async () => ({
    disconnect: jest.fn().mockResolvedValue(undefined),
  }));
  const handle = startSharedCartRealtime(
    {
      merchantId: MERCHANT,
      getCartId: () => CART,
      getVersion: () => 1,
      isCurrent: () => true,
      refresh: jest.fn().mockResolvedValue(undefined),
    },
    { loadAccess, connect } as never
  );
  return { connect, handle };
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.spyOn(Math, 'random').mockReturnValue(0.5);
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

it('backs off after repeated failures and resets after a successful join', async () => {
  const load = jest
    .fn()
    .mockRejectedValueOnce(new Error('x'))
    .mockRejectedValueOnce(new Error('x'))
    .mockResolvedValue(grant(300000));
  const t = setup(load);
  await flush();
  expect(load).toHaveBeenCalledTimes(1);
  jest.advanceTimersByTime(15000);
  await flush();
  expect(load).toHaveBeenCalledTimes(2);
  // Second failure waits 30s (jitter factor 1 at random 0.5), not 15s.
  jest.advanceTimersByTime(15000);
  await flush();
  expect(load).toHaveBeenCalledTimes(2);
  jest.advanceTimersByTime(15000);
  await flush();
  expect(t.connect).toHaveBeenCalledTimes(1);
  t.handle.stop();
});

it('returns to the short retry after a failure that follows a successful join', async () => {
  const load = jest
    .fn()
    .mockRejectedValueOnce(new Error('x'))
    .mockRejectedValueOnce(new Error('x'))
    .mockResolvedValueOnce(grant(300000))
    .mockRejectedValue(new Error('x'));
  const t = setup(load);
  await flush();
  jest.advanceTimersByTime(15000);
  await flush();
  jest.advanceTimersByTime(30000);
  await flush();
  expect(t.connect).toHaveBeenCalledTimes(1);
  // Renewal fails: the failure count was reset by the join, so retry is 15s.
  jest.advanceTimersByTime(300000);
  await flush();
  const calls = load.mock.calls.length;
  jest.advanceTimersByTime(15000);
  await flush();
  expect(load.mock.calls.length).toBe(calls + 1);
  t.handle.stop();
});

it('uses a grant a few seconds longer than the server cap, clamped', async () => {
  const t = setup(jest.fn().mockResolvedValue(grant(303000)));
  await flush();
  expect(t.connect).toHaveBeenCalledTimes(1);
  t.handle.stop();
});

it.each([
  ['an expired grant', 500],
  ['an implausibly long grant', 2 * 3600000],
])('does not connect with %s', async (_name, ttl) => {
  const t = setup(jest.fn().mockResolvedValue(grant(ttl)));
  await flush();
  expect(t.connect).not.toHaveBeenCalled();
  t.handle.stop();
});

it('does not connect without a grant', async () => {
  const t = setup(jest.fn().mockResolvedValue(null));
  await flush();
  expect(t.connect).not.toHaveBeenCalled();
  t.handle.stop();
});
