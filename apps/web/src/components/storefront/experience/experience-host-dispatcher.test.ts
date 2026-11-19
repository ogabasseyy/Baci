import { expect, it, vi } from 'vitest';

const commerceProbe = vi.hoisted(() => ({
  loaded: vi.fn(),
  shouldDelay: false,
  release: undefined as undefined | (() => void),
  dispatch: vi.fn(async (request: { method: string }) => ({
    status: 'ok' as const,
    value: request.method,
  })),
}));
const customerProbe = vi.hoisted(() => ({ identity: { id: 'shopper-1' } }));

vi.mock('@/contexts/customer-live-identity', () => ({
  getLiveCustomerIdentity: () => customerProbe.identity,
}));

vi.mock('./experience-launch-client', () => ({
  readExperienceCatalog: vi.fn(async () => ({ products: [] })),
}));

vi.mock('./experience-commerce-dispatcher', async () => {
  commerceProbe.loaded();
  if (commerceProbe.shouldDelay)
    await new Promise<void>((resolve) => {
      commerceProbe.release = resolve;
    });
  return {
    dispatchExperienceCommerceRequest: commerceProbe.dispatch,
  };
});

import { createExperienceHostDispatcher } from './experience-host-dispatcher';

function createHarness({
  isActive = vi.fn(async () => true),
  dispatcher = createExperienceHostDispatcher,
}: {
  isActive?: () => Promise<boolean>;
  dispatcher?: typeof createExperienceHostDispatcher;
} = {}) {
  let epoch = 1;
  let partition = 'p';
  const host = {
    current: () => ({
      route: { epoch },
      binding: {
        instanceId: 'i',
        buildDigest: 'b',
        shopperPartition: partition,
      },
      revision: 'r',
      generation: 1,
      active: true,
      transition: false,
    }),
    navigate: vi.fn(async (path: string) => path),
  };
  const run = dispatcher({
    current: () =>
      ({
        data: {
          stateUrl: '/api/storefront/experience/state',
          bootstrap: {
            catalog: { products: [], revision: 'r' },
            capabilities: ['cart.mutate'],
          },
        },
      }) as never,
    host: host as never,
    live: {
      current: {
        cart: { experienceCommandPort: { withAdmission: vi.fn() } } as never,
        router: { refresh: vi.fn(), push: vi.fn() },
      },
    },
    isActive,
    rebind: vi.fn(),
    merchantSlug: 'qa1',
    present: vi.fn(),
  });
  return {
    run,
    host,
    setEpoch: (value: number) => (epoch = value),
    setPartition: (value: string) => (partition = value),
  };
}

it('does not load commerce for navigation or catalog bridge requests', async () => {
  commerceProbe.loaded.mockClear();
  const { run } = createHarness();

  await run({
    method: 'navigation.go',
    requestId: 'nav',
    args: { path: '/' },
  } as never);
  await run({
    method: 'catalog.collection',
    requestId: 'collection',
    args: { handle: 'featured' },
  } as never);
  await run({
    method: 'catalog.product',
    requestId: 'product',
    args: { handle: 'phone' },
  } as never);

  expect(commerceProbe.loaded).not.toHaveBeenCalled();
});

it('denies route and shopper changes that happen while commerce is loading', async () => {
  commerceProbe.loaded.mockClear();
  commerceProbe.dispatch.mockClear();
  commerceProbe.shouldDelay = true;
  commerceProbe.release = undefined;
  const isActive = vi.fn(async () => true);
  const { run, setEpoch } = createHarness({ isActive });

  const pendingRouteRequest = run({
    method: 'cart.add',
    requestId: 'original',
    args: { productId: 'p', quantity: 1 },
  } as never);
  await vi.waitFor(() => expect(commerceProbe.release).toBeTypeOf('function'));

  customerProbe.identity = { id: 'shopper-2' };
  const shopperIsActive = vi.fn(async () => true);
  const shopper = createHarness({ isActive: shopperIsActive });
  const pendingShopperRequest = shopper.run({
    method: 'checkout.open',
    requestId: 'checkout',
    args: {},
  } as never);
  await Promise.resolve();
  customerProbe.identity = { id: 'shopper-3' };
  const partitionIsActive = vi.fn(async () => true);
  const partitionHarness = createHarness({ isActive: partitionIsActive });
  const pendingPartitionRequest = partitionHarness.run({
    method: 'cart.remove',
    requestId: 'remove',
    args: { lineId: 'line-1' },
  } as never);
  await Promise.resolve();
  partitionHarness.setPartition('p2');
  setEpoch(2);
  const release = commerceProbe.release as (() => void) | undefined;
  release?.();

  expect(await pendingRouteRequest).toMatchObject({
    status: 'error',
    code: 'STALE_ROUTE',
  });
  expect(await pendingShopperRequest).toMatchObject({
    status: 'error',
    code: 'STALE_ROUTE',
  });
  expect(await pendingPartitionRequest).toMatchObject({
    status: 'error',
    code: 'STALE_ROUTE',
  });
  expect(isActive).toHaveBeenCalledTimes(2);
  expect(shopperIsActive).toHaveBeenCalledTimes(2);
  expect(partitionIsActive).toHaveBeenCalledTimes(2);
  expect(commerceProbe.dispatch).not.toHaveBeenCalled();
  commerceProbe.shouldDelay = false;
});

it('does not enqueue after the original route changes while the live publication read is pending', async () => {
  let release: (value: boolean) => void = () => {};
  const withAdmission = vi.fn();
  let epoch = 1;
  const host = {
    current: () => ({
      route: { epoch },
      binding: { instanceId: 'i', buildDigest: 'b', shopperPartition: 'p' },
      revision: 'r',
      generation: 1,
      active: true,
      transition: false,
    }),
    navigate: vi.fn(),
  };
  const run = createExperienceHostDispatcher({
    current: () =>
      ({
        data: {
          stateUrl: '/api/storefront/experience/state',
          bootstrap: {
            catalog: { products: [], revision: 'r' },
            capabilities: ['cart.mutate'],
          },
        },
      }) as never,
    host: host as never,
    live: {
      current: {
        cart: { experienceCommandPort: { withAdmission } } as never,
        router: { refresh: vi.fn(), push: vi.fn() },
      },
    },
    isActive: () =>
      new Promise((resolve) => {
        release = resolve;
      }),
    rebind: vi.fn(),
    merchantSlug: 'qa1',
    present: vi.fn(),
  });
  const pending = run({
    method: 'cart.add',
    requestId: 'original',
    args: { productId: 'p', quantity: 1 },
  } as never);
  epoch = 2;
  release(true);
  expect(await pending).toMatchObject({ status: 'error', code: 'STALE_ROUTE' });
  expect(withAdmission).not.toHaveBeenCalled();
  commerceProbe.shouldDelay = false;
});
