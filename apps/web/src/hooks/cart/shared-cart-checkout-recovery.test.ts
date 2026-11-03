import { expect, it, vi } from 'vitest';
import { fetchWithCsrf } from '@/lib/api-client';
import { prepareSharedCartCheckout } from './shared-cart-checkout-client';

vi.mock('@/lib/api-client', () => ({ fetchWithCsrf: vi.fn() }));

it('requests recovery authority when preparing a UBA cart', async () => {
  vi.mocked(fetchWithCsrf).mockResolvedValue(
    new Response('{}', { status: 400 })
  );
  await prepareSharedCartCheckout({
    cartId: '22222222-2222-4222-8222-222222222222',
    expectedVersion: 3,
    operationId: 'prep-op-1',
    recoveryForRedvault: true,
  });
  const init = vi.mocked(fetchWithCsrf).mock.calls[0]?.[1];
  expect(JSON.parse(String(init?.body))).toMatchObject({
    recoveryForRedvault: true,
  });
});
