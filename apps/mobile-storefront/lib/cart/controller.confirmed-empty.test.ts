import { createNativeCartController } from './controller';
import { NativeCartError } from './native-cart-error';

jest.mock('expo/fetch', () => ({ fetch: jest.fn() }));
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

const merchant = '11111111-1111-4111-8111-111111111111';

/** A device with a cart session but no server cart and no local items. */
function setup() {
  const client = {
    context: jest.fn(async () => ({ actor: 'guest', cartId: null })),
    bootstrap: jest.fn(),
    read: jest.fn(),
    create: jest.fn(),
    command: jest.fn(),
    recoverCreation: jest.fn().mockResolvedValue(null),
  };
  const status = jest.fn();
  const controller = createNativeCartController({
    merchantId: merchant,
    client,
    receipts: {
      read: jest.fn().mockResolvedValue(null),
      save: jest.fn().mockResolvedValue(undefined),
      clear: jest.fn().mockResolvedValue(undefined),
    },
    newOperationId: () => 'key-1',
    getLegacy: () => ({ items: [], sharedCartRef: undefined }),
    repairLegacy: jest.fn(),
    loadProduct: async () => null,
    publish: jest.fn(),
    status,
    isCurrent: () => true,
  });
  return { client, controller, status };
}

it('shows loading on the first check of an empty cart', async () => {
  const s = setup();
  await s.controller.refresh();
  expect(s.status.mock.calls).toEqual([['loading'], ['ready']]);
});

it('re-checks a confirmed empty cart silently', async () => {
  const s = setup();
  await s.controller.refresh();
  s.status.mockClear();
  await s.controller.refresh();
  expect(s.status.mock.calls).toEqual([['ready']]);
  expect(s.client.read).not.toHaveBeenCalled();
});

it('shows loading again after a failed re-check', async () => {
  const s = setup();
  await s.controller.refresh();
  s.client.context.mockRejectedValueOnce(new NativeCartError('offline'));
  await expect(s.controller.refresh()).rejects.toThrow();
  s.status.mockClear();
  await s.controller.refresh();
  expect(s.status.mock.calls).toEqual([['loading'], ['ready']]);
});
