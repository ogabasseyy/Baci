import { createNativeCartAccountOps } from './controller-account';
import { NativeCartError } from './shared-cart-client';

const snapshot = { cartId: 'cart-1', version: 3 } as never;

function makeOps(client: Record<string, unknown>) {
  const accept = jest.fn(async () => {});
  const coordinator = {
    linkAccount: jest.fn(async () => snapshot),
  };
  const ops = createNativeCartAccountOps({
    accept,
    assertCurrent: jest.fn(),
    coordinator: coordinator as never,
    ensureCart: jest.fn(async () => snapshot),
    options: {
      client,
      isCurrent: () => true,
      status: jest.fn(),
    } as never,
    serial: (async (run: () => Promise<unknown>) => run()) as never,
  });
  return { accept, coordinator, ops };
}

describe('createNativeCartAccountOps', () => {
  it('bootstraps before reading the saved account cart when no context exists', async () => {
    const bootstrap = jest.fn(async () => {});
    const { ops } = makeOps({
      bootstrap,
      context: jest.fn(async () => null),
      savedAccountCart: jest.fn(async () => ({ cart: snapshot })),
    });
    await expect(ops.savedCart()).resolves.toBe(snapshot);
    expect(bootstrap).toHaveBeenCalledTimes(1);
  });

  it('returns null when the account has no saved cart', async () => {
    const { ops } = makeOps({
      bootstrap: jest.fn(),
      context: jest.fn(async () => ({ cartId: 'cart-1' })),
      savedAccountCart: jest.fn(async () => ({ cart: null })),
    });
    await expect(ops.savedCart()).resolves.toBeNull();
  });

  it('fails closed when the client cannot read saved carts', async () => {
    const { ops } = makeOps({});
    await expect(ops.savedCart()).rejects.toBeInstanceOf(NativeCartError);
  });

  it('does not create an empty cart before adopting the saved cart', async () => {
    const { accept, coordinator, ops } = makeOps({});
    await ops.linkAccount({ choice: 'use_saved' } as never);
    expect(coordinator.linkAccount).toHaveBeenCalledTimes(1);
    expect(accept).toHaveBeenCalledWith(snapshot);
  });

  it('reviews checkout against the current cart version', async () => {
    const prepareCheckout = jest.fn(async () => ({ review: true }));
    const { ops } = makeOps({ prepareCheckout });
    await expect(ops.reviewCheckout('op-1')).resolves.toEqual({ review: true });
    expect(prepareCheckout).toHaveBeenCalledWith({
      cartId: 'cart-1',
      expectedVersion: 3,
      operationId: 'op-1',
    });
  });

  it('fails closed when checkout preparation is unavailable', async () => {
    const { ops } = makeOps({});
    await expect(ops.reviewCheckout('op-1')).rejects.toBeInstanceOf(
      NativeCartError
    );
  });
});
