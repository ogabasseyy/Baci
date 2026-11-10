import { expect, it, vi } from 'vitest';

const f = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('./experience-launch-client', () => ({
  readExperienceCatalog: f.read,
}));

import { dispatchExperienceCommerceRequest } from './experience-commerce-dispatcher';

it.each([
  false,
  true,
])('rechecks admission after fetching a product outside the bootstrap (revoked=%s)', async (revoked) => {
  let allowed = true;
  const productId = '10000000-0000-4000-8000-000000000002';
  const submit = vi.fn(async () => ({
    status: 'ok' as const,
    value: { lines: [], version: 1, total: 0, currency: 'NGN' },
  }));
  const port = { submit, reconcile: vi.fn() };
  f.read.mockImplementationOnce(async () => {
    allowed = !revoked;
    return {
      products: [
        {
          id: productId,
          slug: 'extra',
          name: 'Extra',
          price: 1,
          currency: 'NGN',
          image: null,
          variants: [],
          available: true,
        },
      ],
      revision: 'fresh',
    };
  });
  const result = await dispatchExperienceCommerceRequest(
    {
      method: 'cart.add',
      requestId: 'request',
      args: { productId, quantity: 1 },
    } as never,
    {
      state: {
        data: {
          stateUrl: '/api/storefront/experience/state',
          bootstrap: {
            capabilities: ['cart.mutate', 'catalog.read'],
            catalog: { products: [], revision: 'initial' },
          },
        },
      } as never,
      live: {
        current: {
          cart: { experienceCommandPort: { withAdmission: () => port } },
          router: { push: vi.fn(), refresh: vi.fn() },
        },
      } as never,
      merchantSlug: 'qa1',
      present: vi.fn(),
      admit: () =>
        allowed ? { allowed: true } : { allowed: false, code: 'STALE_ROUTE' },
      rebind: vi.fn(),
      isActive: async () => true,
      identityMatches: () => true,
    }
  );
  expect(result.status).toBe(revoked ? 'error' : 'ok');
  expect(submit).toHaveBeenCalledTimes(revoked ? 0 : 1);
});

it('routes SDK reconciliation to the bound existing cart port using the original operation ID', async () => {
  const reconcile = vi.fn(async (operationId: string) => ({
    status: 'indeterminate' as const,
    operationId,
  }));
  const submit = vi.fn();
  const withAdmission = vi.fn(() => ({ reconcile, submit }));
  const result = await dispatchExperienceCommerceRequest(
    {
      method: 'cart.reconcile',
      requestId: 'new-envelope',
      args: { operationId: 'original-operation' },
    } as never,
    {
      state: {
        data: {
          bootstrap: {
            capabilities: ['cart.mutate'],
            catalog: { products: [], revision: 'r' },
          },
        },
      } as never,
      live: {
        current: { cart: { experienceCommandPort: { withAdmission } } },
      } as never,
      merchantSlug: 'qa1',
      present: vi.fn(),
      admit: () => ({ allowed: true }),
      rebind: vi.fn(),
      isActive: async () => true,
      identityMatches: () => true,
    }
  );
  expect(result).toEqual({
    status: 'indeterminate',
    operationId: 'original-operation',
  });
  expect(reconcile).toHaveBeenCalledExactlyOnceWith('original-operation');
  expect(submit).not.toHaveBeenCalled();
});
