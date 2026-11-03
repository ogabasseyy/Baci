import { expect, it, vi } from 'vitest';

vi.mock('@/hooks/cart/shared-cart-client', () => ({
  prepareSharedCartCheckout: vi.fn(),
}));

import { dispatchExperienceCommerceRequest } from './experience-commerce-dispatcher';
import type { ExperienceHostLive } from './experience-host-runtime';
import type { ExperienceShellState } from './experience-shell-controller';

function setup(allowed: boolean) {
  const refreshSharedCart = vi.fn(async () => {});
  const present = vi.fn();
  const state = {
    data: {
      bootstrap: {
        currency: 'USD',
        catalog: { products: [], revision: 'catalog-r1' },
        capabilities: [],
      },
    },
  } as unknown as ExperienceShellState;
  const live = {
    current: {
      cart: { syncStatus: 'synced', refreshSharedCart },
    },
  } as unknown as { current: ExperienceHostLive };
  const admit = vi.fn(() =>
    allowed
      ? { allowed: true as const }
      : { allowed: false as const, code: 'STALE_ROUTE' as const }
  );
  return { state, live, admit, present, refreshSharedCart };
}

it('opens trusted checkout only after the shared cart is admitted and refreshed', async () => {
  const f = setup(true);
  const result = await dispatchExperienceCommerceRequest(
    { method: 'checkout.open', requestId: 'checkout-1', args: {} } as never,
    {
      ...f,
      merchantSlug: 'shop',
      rebind: vi.fn(),
      isActive: async () => true,
      identityMatches: () => true,
    }
  );

  expect(result).toMatchObject({ status: 'ok', value: { presented: true } });
  expect(f.refreshSharedCart).toHaveBeenCalledOnce();
  expect(f.present).toHaveBeenCalledOnce();
});

it('rejects checkout when route admission is stale without refreshing or presenting', async () => {
  const f = setup(false);
  const result = await dispatchExperienceCommerceRequest(
    { method: 'checkout.open', requestId: 'checkout-stale', args: {} } as never,
    {
      ...f,
      merchantSlug: 'shop',
      rebind: vi.fn(),
      isActive: async () => true,
      identityMatches: () => true,
    }
  );

  expect(result).toMatchObject({ status: 'error', code: 'STALE_ROUTE' });
  expect(f.refreshSharedCart).not.toHaveBeenCalled();
  expect(f.present).not.toHaveBeenCalled();
});
