import { beforeEach, expect, it, vi } from 'vitest';
import { fetchWithCsrf } from '@/lib/api-client';
import { beginCartSessionRetirement } from './cart-session-write-fence';
import { bootstrapSharedCart } from './shared-cart-bootstrap-client';

vi.mock('@/lib/api-client', () => ({ fetchWithCsrf: vi.fn() }));
beforeEach(() => {
  vi.mocked(fetchWithCsrf).mockReset();
});
it('coalesces concurrent merchant bootstrap calls without losing the scoped request', async () => {
  let finish!: (response: Response) => void;
  vi.mocked(fetchWithCsrf).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  const first = bootstrapSharedCart('shop');
  const second = bootstrapSharedCart('shop');
  expect(fetchWithCsrf).toHaveBeenCalledOnce();
  expect(fetchWithCsrf).toHaveBeenCalledWith(
    '/api/storefront/cart/bootstrap',
    expect.objectContaining({ body: JSON.stringify({ merchantSlug: 'shop' }) })
  );
  finish(new Response('{}', { status: 200 }));
  await expect(first).resolves.toEqual({ ok: true });
  await expect(second).resolves.toEqual({ ok: true });
});
it('preserves CSRF rejection as forbidden instead of authorizing preserved-session adoption', async () => {
  vi.mocked(fetchWithCsrf).mockResolvedValue(
    new Response(JSON.stringify({ code: 'forbidden' }), { status: 403 })
  );
  await expect(bootstrapSharedCart('shop')).resolves.toEqual({
    ok: false,
    code: 'forbidden',
    retryable: false,
  });
});

it('keeps host-resolved bootstrap independent of named merchant flights', async () => {
  const finishes: ((response: Response) => void)[] = [];
  vi.mocked(fetchWithCsrf).mockImplementation(
    () => new Promise((resolve) => finishes.push(resolve))
  );
  const first = bootstrapSharedCart('merchant-a');
  const second = bootstrapSharedCart('merchant-b');
  const unnamed = bootstrapSharedCart();
  expect(fetchWithCsrf).toHaveBeenCalledTimes(3);
  expect(fetchWithCsrf).toHaveBeenLastCalledWith(
    '/api/storefront/cart/bootstrap',
    expect.objectContaining({ body: '{}' })
  );
  const retirement = beginCartSessionRetirement('merchant-c');
  const drained = vi.fn();
  void retirement.drained.then(drained);
  try {
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(drained).not.toHaveBeenCalled();
    for (const finish of finishes) finish(new Response('{}', { status: 200 }));
    await Promise.all([first, second, unnamed, retirement.drained]);
    expect(drained).toHaveBeenCalledOnce();
  } finally {
    retirement.release();
  }
});
