import {
  PRODUCT_A,
  PRODUCT_B,
  quantities,
  setup,
  shopItem,
  snapshotOf,
} from './controller-edits.test-support';
import { NativeCartError } from './native-cart-error';

jest.mock('expo/fetch', () => ({ fetch: jest.fn() }));
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

const pendingLine = {
  id: 'pending-line::9',
  product_id: PRODUCT_B,
  slug: 'b',
  name: 'B',
  price: 5,
  quantity: 1,
};

describe('N1: an edit already on the server is not counted twice', () => {
  it('never shows a doubled quantity after an uncertain write that landed', async () => {
    const s = setup({ live: true });
    s.seed([{ id: 'line-1', productId: PRODUCT_A, quantity: 1 }]);
    await s.controller.refresh();
    s.client.command.mockImplementationOnce(() => {
      s.server.lines[0].quantity = 2;
      s.server.version += 1;
      return Promise.reject(new NativeCartError('network', true));
    });
    await expect(
      s.controller.write({ type: 'add', item: shopItem(PRODUCT_A, 1) })
    ).rejects.toBeInstanceOf(NativeCartError);
    const shown = s.screen.history.map((items) => items[0]?.quantity);
    expect(shown).not.toContain(3);
    expect(quantities(s.screen.items)).toEqual([2]);
  });
});

describe('N2: predicted lines are never treated as the shopper’s own', () => {
  it('ignores a stored predicted line when the server already has a cart', async () => {
    const s = setup({ live: true });
    s.screen.items = [pendingLine];
    await s.controller.refresh();
    expect(s.screen.items).toEqual([]);
    expect(s.client.read).toHaveBeenCalled();
  });

  it('does not import a stored predicted line into a new cart', async () => {
    const s = setup();
    s.screen.items = [pendingLine];
    await s.controller.write({ type: 'add', item: shopItem(PRODUCT_A) });
    expect(s.calls[0]).toBe('create:0');
    expect(s.server.lines).toHaveLength(1);
  });
});

describe('controller-level gaps', () => {
  it('lost device proof then an add does not double count', async () => {
    const s = setup({ live: true });
    s.seed([{ id: 'line-1', productId: PRODUCT_A, quantity: 1 }]);
    await s.controller.refresh();
    s.loseProof();
    await s.controller.refresh();
    expect(s.screen.items).toEqual([]);
    s.server.lines = [];
    await s.controller.write({ type: 'add', item: shopItem(PRODUCT_B) });
    expect(s.calls).toEqual(['create:0', 'command:add']);
    expect(s.server.lines.map((l) => l.quantity)).toEqual([1]);
  });

  it('keeps a concurrent remote change when a version conflict is retried', async () => {
    const s = setup({ live: true });
    s.seed([{ id: 'line-1', productId: PRODUCT_A, quantity: 1 }]);
    await s.controller.refresh();
    // Another device adds a line the controller has not seen yet.
    s.server.lines.push({ id: 'remote-1', productId: PRODUCT_B, quantity: 1 });
    s.server.version += 1;
    await s.controller.write({ type: 'quantity', id: 'line-1', quantity: 3 });
    expect(s.server.lines.map((l) => [l.id, l.quantity])).toEqual([
      ['line-1', 3],
      ['remote-1', 1],
    ]);
    expect(s.screen.items.map((i) => i.id).sort()).toEqual([
      'line-1',
      'remote-1',
    ]);
    expect(snapshotOf(1, []).version).toBe(1);
  });
});

describe('review follow-ups', () => {
  it('tells the shopper when a tap targeted a line that never landed', async () => {
    const s = setup({ live: true });
    await s.controller.refresh();
    s.failures.push(new NativeCartError('invalid_item'));
    const add = s.controller.write({ type: 'add', item: shopItem(PRODUCT_A) });
    const pendingId = s.screen.items[0].id;
    const tap = s.controller.write({
      type: 'quantity',
      id: pendingId,
      quantity: 4,
    });
    await Promise.allSettled([add, tap]);
    expect(s.failed).toHaveBeenCalledTimes(2);
    expect(s.screen.items).toEqual([]);
    expect(s.client.command).toHaveBeenCalledTimes(1);
  });

  it('still resolves a tap on a pending line after many other adds', async () => {
    const s = setup({ live: true });
    await s.controller.refresh();
    s.holdCommands();
    const first = s.controller.write({
      type: 'add',
      item: shopItem(PRODUCT_A),
    });
    const pendingId = s.screen.items[0].id;
    const others = Array.from({ length: 60 }, (_, i) =>
      s.controller.write({
        type: 'add',
        item: shopItem(
          `55555555-5555-4555-8555-${String(i).padStart(12, '0')}`
        ),
      })
    );
    const bump = s.controller.write({
      type: 'quantity',
      id: pendingId,
      quantity: 4,
    });
    await s.drain(first, ...others, bump);
    expect(
      s.server.lines.find((l) => l.productId === PRODUCT_A)?.quantity
    ).toBe(4);
  });

  it('reverts unconfirmed edits on teardown but leaves a settled cart alone', async () => {
    const s = setup({ live: true });
    s.seed([{ id: 'line-1', productId: PRODUCT_A, quantity: 1 }]);
    await s.controller.refresh();
    expect(s.controller.revertPending()).toBeNull();
    s.holdCommands();
    const edit = s.controller.write({
      type: 'quantity',
      id: 'line-1',
      quantity: 5,
    });
    expect(quantities(s.screen.items)).toEqual([5]);
    expect(quantities(s.controller.revertPending() ?? [])).toEqual([1]);
    await s.drain(edit);
  });
});

describe('Codex follow-ups', () => {
  it('keeps a queued quantity visible once its add is confirmed', async () => {
    const s = setup({ live: true });
    await s.controller.refresh();
    s.holdCommands();
    const add = s.controller.write({ type: 'add', item: shopItem(PRODUCT_A) });
    const bump = s.controller.write({
      type: 'quantity',
      id: s.screen.items[0].id,
      quantity: 4,
    });
    await s.release();
    await s.release();
    expect(s.screen.items.map((i) => i.quantity)).toEqual([4]);
    await s.drain(add, bump);
    expect(quantities(s.screen.items)).toEqual([4]);
  });

  it('carries a pending line id through assurance toggles', async () => {
    const s = setup({ live: true });
    await s.controller.refresh();
    s.holdCommands();
    const add = s.controller.write({ type: 'add', item: shopItem(PRODUCT_A) });
    const toggle = s.controller.write({
      type: 'assurance',
      id: s.screen.items[0].id,
    });
    await s.drain(add, toggle);
    expect(s.calls).toEqual(['command:add', 'command:set_assurance']);
  });

  it('does not promise an undo while a retained request can still apply', async () => {
    const s = setup({ live: true });
    s.seed([{ id: 'line-1', productId: PRODUCT_A, quantity: 1 }]);
    await s.controller.refresh();
    s.retainReceiptOnFailure();
    s.failures.push(new NativeCartError('rate_limited'));
    await s.controller
      .write({ type: 'quantity', id: 'line-1', quantity: 5 })
      .catch(() => undefined);
    expect(s.failed).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      'unconfirmed'
    );
  });
});

describe('second review round', () => {
  it('never publishes a doubled quantity when a write succeeds', async () => {
    const s = setup({ live: true });
    s.seed([{ id: 'line-1', productId: PRODUCT_A, quantity: 1 }]);
    await s.controller.refresh();
    await s.controller.write({ type: 'add', item: shopItem(PRODUCT_A, 1) });
    const shown = s.screen.history.map((items) => items[0]?.quantity);
    expect(shown).not.toContain(3);
    expect(quantities(s.screen.items)).toEqual([2]);
  });
});

describe('third review round', () => {
  it('keeps the running prediction on screen while a conflict refresh runs', async () => {
    const s = setup({ live: true });
    s.seed([{ id: 'line-1', productId: PRODUCT_A, quantity: 1 }]);
    await s.controller.refresh();
    s.server.lines.push({ id: 'remote-1', productId: PRODUCT_B, quantity: 1 });
    s.server.version += 1;
    await s.controller.write({ type: 'quantity', id: 'line-1', quantity: 4 });
    const shown = s.screen.history.map(
      (items) => items.find((i) => i.id === 'line-1')?.quantity
    );
    expect(shown.slice(shown.indexOf(4))).not.toContain(1);
  });

  it('clears the failure notice after the next successful edit', async () => {
    const s = setup({ live: true });
    s.seed([{ id: 'line-1', productId: PRODUCT_A, quantity: 1 }]);
    await s.controller.refresh();
    await s.controller.write({ type: 'quantity', id: 'line-1', quantity: 2 });
    expect(s.succeeded).toHaveBeenCalledTimes(1);
  });

  it('predicts a separate line when only a non-color option differs', async () => {
    const s = setup({ live: true });
    s.seed([{ id: 'line-1', productId: PRODUCT_A, quantity: 1 }]);
    await s.controller.refresh();
    s.holdCommands();
    const add = s.controller.write({
      type: 'add',
      item: { ...shopItem(PRODUCT_A), variant_attributes: { size: 'L' } },
    });
    expect(s.screen.items).toHaveLength(2);
    await s.drain(add);
  });
});
