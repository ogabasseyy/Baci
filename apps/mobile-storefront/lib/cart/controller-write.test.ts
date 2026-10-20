import { createNativeCartWrite } from './controller-write';
import { NativeCartError } from './shared-cart-client';

const snapshot = {
  cartId: 'cart-1',
  lines: [{ id: 'line-1', item: { productId: 'p-1' }, quantity: 1 }],
  version: 3,
} as never;

function makeWrite(overrides: Record<string, unknown> = {}) {
  const deps = {
    accept: jest.fn(async () => {}),
    coordinator: { command: jest.fn(async () => snapshot) },
    ensureCart: jest.fn(async () => snapshot),
    getIncoming: () => null,
    getLegacy: () => ({ items: [] }),
    getTerminal: () => false,
    newOperationId: () => 'op-1',
    onMergeConflicts: jest.fn(),
    refresh: jest.fn(async () => {}),
    setIncoming: jest.fn(),
    status: jest.fn(),
    ...overrides,
  };
  return { deps, write: createNativeCartWrite(deps as never) };
}

describe('createNativeCartWrite', () => {
  it('issues an add command against the current version', async () => {
    const { deps, write } = makeWrite();
    await write.write({
      item: { productId: 'p-1' },
      quantity: 2,
      type: 'add',
    } as never);
    expect(deps.coordinator.command).toHaveBeenCalledWith(
      'cart-1',
      expect.objectContaining({ expectedVersion: 3, operationId: 'op-1' })
    );
    expect(deps.accept).toHaveBeenCalledWith(snapshot);
  });

  it('retries a version conflict once after refreshing', async () => {
    const command = jest
      .fn()
      .mockRejectedValueOnce(new NativeCartError('version_conflict'))
      .mockResolvedValueOnce(snapshot);
    const { deps, write } = makeWrite({
      coordinator: { command },
    });
    await write.write({
      item: { productId: 'p-1' },
      quantity: 1,
      type: 'add',
    } as never);
    expect(command).toHaveBeenCalledTimes(2);
    expect(deps.refresh).toHaveBeenCalledTimes(1);
  });

  it('does not retry a second version conflict', async () => {
    const command = jest
      .fn()
      .mockRejectedValue(new NativeCartError('version_conflict'));
    const { write } = makeWrite({ coordinator: { command } });
    await expect(
      write.write({
        item: { productId: 'p-1' },
        quantity: 1,
        type: 'add',
      } as never)
    ).rejects.toBeInstanceOf(NativeCartError);
    expect(command).toHaveBeenCalledTimes(2);
  });

  it('swallows a clear lock only once the cart is terminal', async () => {
    const command = jest
      .fn()
      .mockRejectedValue(new NativeCartError('cart_locked'));
    const { write } = makeWrite({
      coordinator: { command },
      getTerminal: () => true,
    });
    await expect(
      write.write({ type: 'clear' } as never)
    ).resolves.toBeUndefined();
  });

  it('rethrows a clear lock when the cart is not terminal', async () => {
    const command = jest
      .fn()
      .mockRejectedValue(new NativeCartError('cart_locked'));
    const { write } = makeWrite({ coordinator: { command } });
    await expect(
      write.write({ type: 'clear' } as never)
    ).rejects.toBeInstanceOf(NativeCartError);
  });

  it('keeps the server cart for keep_server without issuing a command', async () => {
    const incoming = snapshot;
    const { deps, write } = makeWrite({ getIncoming: () => incoming });
    await write.chooseLegacy('keep_server');
    expect(deps.setIncoming).toHaveBeenCalledWith(null);
    expect(deps.accept).toHaveBeenCalledWith(incoming);
    expect(deps.coordinator.command).not.toHaveBeenCalled();
  });

  it('requires an incoming cart for a legacy choice', async () => {
    const { write } = makeWrite();
    await expect(write.chooseLegacy('keep_server')).rejects.toBeInstanceOf(
      NativeCartError
    );
  });
});
