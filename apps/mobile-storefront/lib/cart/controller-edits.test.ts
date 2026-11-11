import { NativeCartError } from './native-cart-error';

jest.mock('expo/fetch', () => ({ fetch: jest.fn() }));
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

import {
  apply,
  flushAsync,
  PRODUCT_A,
  PRODUCT_B,
  quantities,
  setup,
  shopItem,
  snapshotOf,
} from './controller-edits.test-support';

describe('instant edits on a live cart', () => {
  it('shows the edit at once and settles on the server reply', async () => {
    const s = setup({ live: true });
    s.seed([{ id: 'line-1', productId: PRODUCT_A, quantity: 1 }]);
    await s.controller.refresh();
    s.holdCommands();
    const done = s.controller.write({
      type: 'quantity',
      id: 'line-1',
      quantity: 3,
    });
    expect(quantities(s.screen.items)).toEqual([3]);
    await flushAsync();
    expect(s.client.command).toHaveBeenCalledTimes(1);
    await s.release();
    await done;
    expect(quantities(s.screen.items)).toEqual([3]);
    expect(s.server.lines[0].quantity).toBe(3);
    expect(s.failed).not.toHaveBeenCalled();
  });

  it('puts a rejected edit back and says so, without touching other edits', async () => {
    const s = setup({ live: true });
    s.seed([{ id: 'line-1', productId: PRODUCT_A, quantity: 1 }]);
    await s.controller.refresh();
    s.failures.push(new NativeCartError('invalid_item'));
    await expect(
      s.controller.write({ type: 'add', item: shopItem(PRODUCT_B) })
    ).rejects.toBeInstanceOf(NativeCartError);
    expect(s.screen.items.map((i) => i.id)).toEqual(['line-1']);
    expect(s.failed).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'add' }),
      expect.any(NativeCartError),
      'rolled_back'
    );
  });
});

describe('finding 1: no double count when there is no live cart', () => {
  it('does not show or send a predicted line when no shared cart is held yet', async () => {
    const s = setup();
    s.holdCommands();
    const done = s.controller.write({
      type: 'add',
      item: shopItem(PRODUCT_A, 1),
    });
    expect(s.screen.items).toEqual([]);
    await flushAsync();
    await s.release();
    await done;
    // Created empty, then the one add: the line exists once, not twice.
    expect(s.calls).toEqual(['create:0', 'command:add']);
    expect(s.server.lines).toHaveLength(1);
    expect(s.server.lines[0].quantity).toBe(1);
  });

  it('after a finished order, the next add does not copy a predicted line into the new cart', async () => {
    const s = setup({ live: true });
    s.seed([{ id: 'line-1', productId: PRODUCT_A, quantity: 1 }]);
    await s.controller.refresh();
    s.client.read.mockResolvedValueOnce({
      cart: snapshotOf(5, [], 'completed'),
    } as never);
    await s.controller.refresh();
    expect(s.screen.items).toEqual([]);
    s.server.lines = [];
    s.holdCommands();
    const done = s.controller.write({
      type: 'add',
      item: shopItem(PRODUCT_B, 2),
    });
    expect(s.screen.items).toEqual([]);
    await flushAsync();
    await s.release();
    await done;
    expect(s.calls).toContain('create:0');
    expect(s.server.lines).toHaveLength(1);
    expect(s.server.lines[0].quantity).toBe(2);
  });
});

describe('finding 2: checkout never runs ahead of a shown edit', () => {
  it('queues review behind every edit already on screen', async () => {
    const s = setup({ live: true });
    s.seed([{ id: 'line-1', productId: PRODUCT_A, quantity: 1 }]);
    await s.controller.refresh();
    s.holdCommands();
    const first = s.controller.write({
      type: 'quantity',
      id: 'line-1',
      quantity: 2,
    });
    const second = s.controller.write({
      type: 'quantity',
      id: 'line-1',
      quantity: 3,
    });
    const review = s.controller.reviewCheckout('op-review');
    await flushAsync();
    await s.drain(first, second, review);
    expect(s.calls).toEqual([
      'command:set_quantity',
      'command:set_quantity',
      'checkout',
    ]);
    expect(s.client.prepareCheckout).toHaveBeenCalledWith(
      expect.objectContaining({ expectedVersion: 3 })
    );
  });
});

describe('finding 4: waiting edits survive refreshes and failures', () => {
  it('keeps a queued tap on screen when a refresh lands between two edits', async () => {
    const s = setup({ live: true });
    s.seed([{ id: 'line-1', productId: PRODUCT_A, quantity: 1 }]);
    await s.controller.refresh();
    s.holdCommands();
    const first = s.controller.write({
      type: 'quantity',
      id: 'line-1',
      quantity: 2,
    });
    const refresh = s.controller.refresh();
    const second = s.controller.write({
      type: 'quantity',
      id: 'line-1',
      quantity: 3,
    });
    await s.drain(first, refresh, second);
    const shown = s.screen.history.map((items) => items[0]?.quantity);
    const firstThree = shown.indexOf(3);
    expect(firstThree).toBeGreaterThan(-1);
    expect(shown.slice(firstThree)).not.toContain(2);
    expect(shown.slice(firstThree)).not.toContain(1);
    expect(quantities(s.screen.items)).toEqual([3]);
  });

  it('leaves no phantom line after two rejected adds', async () => {
    const s = setup({ live: true });
    s.seed([{ id: 'line-1', productId: PRODUCT_A, quantity: 1 }]);
    await s.controller.refresh();
    s.failures.push(
      new NativeCartError('invalid_item'),
      new NativeCartError('invalid_item')
    );
    const a = s.controller.write({ type: 'add', item: shopItem(PRODUCT_B) });
    const b = s.controller.write({ type: 'add', item: shopItem(PRODUCT_B) });
    expect(s.screen.items).toHaveLength(2);
    await Promise.allSettled([a, b]);
    expect(s.screen.items.map((i) => i.id)).toEqual(['line-1']);
  });

  it('applies a tap on a not-yet-confirmed line to the real line', async () => {
    const s = setup({ live: true });
    await s.controller.refresh();
    s.holdCommands();
    const add = s.controller.write({ type: 'add', item: shopItem(PRODUCT_A) });
    const pendingId = s.screen.items[0].id;
    expect(pendingId).toMatch(/^pending-line::/);
    const bump = s.controller.write({
      type: 'quantity',
      id: pendingId,
      quantity: 4,
    });
    expect(quantities(s.screen.items)).toEqual([4]);
    await s.drain(add, bump);
    expect(s.server.lines).toEqual([
      { id: 'line-1', productId: PRODUCT_A, quantity: 4 },
    ]);
  });
});

describe('finding 3: an uncertain failure is not reported as undone', () => {
  it('settles against the server and drops the warning once the change is confirmed', async () => {
    const s = setup({ live: true });
    s.seed([{ id: 'line-1', productId: PRODUCT_A, quantity: 1 }]);
    await s.controller.refresh();
    // The request reached the server although the reply was lost.
    s.client.command.mockImplementationOnce(
      async (input: { command: Record<string, unknown> }) => {
        apply(s, input as never);
        throw new NativeCartError('network', true);
      }
    );
    await expect(
      s.controller.write({ type: 'quantity', id: 'line-1', quantity: 5 })
    ).rejects.toBeInstanceOf(NativeCartError);
    expect(s.failed).not.toHaveBeenCalled();
    expect(s.succeeded).toHaveBeenCalled();
    expect(quantities(s.screen.items)).toEqual([5]);
  });
});
