import { expect, it, vi } from 'vitest';
import { createExperienceCartAdapter } from './experience-cart-adapter';

it('uses only the host command port and rejects variant, amount and quantity injection', async () => {
  const submit = vi.fn(async () => ({
    status: 'ok' as const,
    value: { lines: [], version: 1, total: 0, currency: 'NGN' },
  }));
  const adapter = createExperienceCartAdapter({
    commandPort: { submit, reconcile: vi.fn() },
    readPublicCart: async () => ({
      status: 'ok',
      value: { lines: [], version: 1, total: 0, currency: 'NGN' },
    }),
    capabilities: ['cart.mutate', 'cart.read-public'],
    catalog: () => ({
      products: [
        {
          id: '10000000-0000-4000-8000-000000000001',
          slug: 'phone',
          name: 'Synthetic',
          price: 100,
          currency: 'NGN',
          image: null,
          requiresVariant: true,
          variants: [
            {
              id: '20000000-0000-4000-8000-000000000001',
              label: 'Blue',
              available: true,
            },
          ],
        },
      ],
      revision: 'r',
    }),
  });
  expect(
    await adapter.add({
      productId: '10000000-0000-4000-8000-000000000001',
      quantity: 1,
    })
  ).toMatchObject({ code: 'INVALID_REQUEST' });
  expect(
    await adapter.add({
      productId: '10000000-0000-4000-8000-000000000001',
      variantId: '20000000-0000-4000-8000-000000000001',
      quantity: 1,
    })
  ).toMatchObject({ status: 'ok' });
  expect(submit).toHaveBeenCalledOnce();
});
