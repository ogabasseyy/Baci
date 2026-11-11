import { createNativeRealtimeDeps } from './shared-cart-realtime-transport';

const removeChannel = jest.fn().mockResolvedValue('ok');
const disconnect = jest.fn();
const setAuth = jest.fn().mockResolvedValue(undefined);
const subscribe = jest.fn();
const on = jest.fn();
const channel = jest.fn();
const mockCreateClient = jest.fn();
jest.mock('@supabase/supabase-js', () => ({
  createClient: (...args: unknown[]) => mockCreateClient(...args),
}));
jest.mock('@/lib/supabase', () => ({
  getSupabaseRealtimeConfig: () => ({
    url: 'https://x.supabase.co',
    key: 'public-key',
  }),
}));

const PROOF = 'cp1.aaa.bbb';
const base = {
  merchantSlug: 'alpha',
  apiOrigin: 'https://api.example.com',
};
function storage() {
  return { get: jest.fn().mockResolvedValue(PROOF) } as never;
}
const grant = {
  topic: 'cart:m:c',
  token: 'receive',
  expiresAt: '2026-11-10T08:00:00.000Z',
};
function response(status: number, body: unknown) {
  return { ok: status < 400, status, json: async () => body } as Response;
}

beforeEach(() => {
  jest.clearAllMocks();
  on.mockReturnValue({ subscribe });
  channel.mockReturnValue({ on });
  mockCreateClient.mockReturnValue({
    realtime: { setAuth, disconnect },
    channel,
    removeChannel,
  });
});

it('mints receive access with the device bearer proof only', async () => {
  const fetcher = jest.fn().mockResolvedValue(response(200, grant));
  const deps = createNativeRealtimeDeps({
    ...base,
    merchantId: 'm',
    storage: storage(),
    fetcher,
  });
  await expect(deps.loadAccess()).resolves.toEqual(grant);
  const [url, init] = fetcher.mock.calls[0];
  expect(url).toBe(
    'https://api.example.com/api/storefront/cart/realtime?merchantSlug=alpha'
  );
  expect(init).toMatchObject({
    method: 'GET',
    credentials: 'omit',
    headers: { Authorization: `Bearer ${PROOF}` },
  });
});

it('treats denial as no access and transient failure as an error', async () => {
  const run = (status: number, body: unknown = {}) =>
    createNativeRealtimeDeps({
      ...base,
      merchantId: 'm',
      storage: storage(),
      fetcher: jest.fn().mockResolvedValue(response(status, body)),
    }).loadAccess();
  await expect(run(404)).resolves.toBeNull();
  await expect(run(200, { topic: 1 })).resolves.toBeNull();
  await expect(run(503)).rejects.toThrow();
  await expect(run(429)).rejects.toThrow();
});

it('returns no access without a stored proof', async () => {
  const fetcher = jest.fn();
  const deps = createNativeRealtimeDeps({
    ...base,
    merchantId: 'm',
    storage: { get: jest.fn().mockResolvedValue(null) } as never,
    fetcher,
  });
  await expect(deps.loadAccess()).resolves.toBeNull();
  expect(fetcher).not.toHaveBeenCalled();
});

it('joins a private broadcast channel on an isolated nonpersistent client', async () => {
  const deps = createNativeRealtimeDeps({
    ...base,
    merchantId: 'm',
    storage: storage(),
    fetcher: jest.fn(),
  });
  const onEvent = jest.fn();
  const onStatus = jest.fn();
  const connection = await deps.connect(grant, onEvent, onStatus);
  expect(mockCreateClient.mock.calls[0][2]).toMatchObject({
    auth: { persistSession: false, autoRefreshToken: false },
  });
  expect(setAuth).toHaveBeenCalledWith('receive');
  expect(channel).toHaveBeenCalledWith('cart:m:c', {
    config: { private: true, broadcast: { self: false } },
  });
  expect(on.mock.calls[0].slice(0, 2)).toEqual([
    'broadcast',
    { event: 'cart_changed' },
  ]);
  on.mock.calls[0][2]({ payload: { version: 2 } });
  expect(onEvent).toHaveBeenCalledWith({ version: 2 });
  subscribe.mock.calls[0][0]('SUBSCRIBED');
  expect(onStatus).toHaveBeenCalledWith(true);
  await connection.disconnect();
  expect(removeChannel).toHaveBeenCalled();
  expect(disconnect).toHaveBeenCalled();
});
