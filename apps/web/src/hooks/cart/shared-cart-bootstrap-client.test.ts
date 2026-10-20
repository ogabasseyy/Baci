import { beforeEach, expect, it, vi } from 'vitest';
import { fetchWithCsrf } from '@/lib/api-client';
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
