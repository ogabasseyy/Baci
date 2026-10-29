import { beforeEach, expect, it, vi } from 'vitest';
import { runCartQuotaProbe } from './probe-cart-quota';

const mocks = vi.hoisted(() => ({ create: vi.fn(), rpc: vi.fn() }));
vi.mock('@/lib/cart/scoped-client', () => ({
  createCartQuotaScopedClient: mocks.create,
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.create.mockReturnValue({ rpc: mocks.rpc });
});

it('does not mint a capability without an explicit execute flag', async () => {
  await expect(runCartQuotaProbe([])).rejects.toThrow('Pass --execute');
  expect(mocks.create).not.toHaveBeenCalled();
});

it('uses a fresh scoped client to verify increments and the guard', async () => {
  let count = 0;
  mocks.rpc.mockImplementation((name: string) => ({
    abortSignal: async () =>
      name === 'increment_commerce_cart_quota'
        ? { data: { count: ++count, resetTime: 1_800_000_000_000 }, error: null }
        : { data: null, error: { message: 'Cart quota request is outside its capability scope' } },
  }));
  await expect(runCartQuotaProbe(['--execute'])).resolves.toBeUndefined();
  expect(mocks.create).toHaveBeenCalledWith(expect.stringMatching(/^operator-probe:/), 60_000);
});
