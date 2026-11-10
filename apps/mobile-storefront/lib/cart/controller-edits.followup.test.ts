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
