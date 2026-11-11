import type { CartSnapshot } from '@baci/shared/cart';
import { wireEditQueue } from './controller-edit-wiring';
import { createPendingEdits } from './pending-edits';

const snap = { cartId: 'c' } as CartSnapshot;
const add = {
  type: 'add',
  item: { product_id: 'a', slug: 'a', name: 'a', price: 1, quantity: 1 },
} as const;

function setup(state: {
  snapshot: CartSnapshot | null;
  terminal: boolean;
  incoming: CartSnapshot | null;
}) {
  const shown: unknown[][] = [];
  const edits = createPendingEdits((items) => shown.push(items));
  edits.confirm([]);
  const write = jest.fn().mockResolvedValue(undefined);
  const read = jest.fn().mockResolvedValue(null);
  const options = {
    merchantId: 'm',
    getLegacy: () => ({ items: [], sharedCartRef: undefined }),
    client: { context: jest.fn().mockResolvedValue(null) },
    onWriteFailed: jest.fn(),
    onWriteSucceeded: jest.fn(),
  };
  const enqueue = wireEditQueue({
    edits,
    options: options as never,
    receipts: { read } as never,
    serial: (run) => run(),
    refresh: jest.fn().mockResolvedValue(undefined),
    transmission: { reset: jest.fn(), sent: () => true },
    write,
    state: () => state,
  });
  return { enqueue, write, shown, options, read };
}

it('predicts the edit on screen only while a live cart is held', async () => {
  const live = setup({ snapshot: snap, terminal: false, incoming: null });
  const pending = live.enqueue(add);
  expect(live.shown.at(0)).toHaveLength(1);
  await pending;
  expect(live.write).toHaveBeenCalledWith(add);

  const none = setup({ snapshot: null, terminal: false, incoming: null });
  await none.enqueue(add);
  expect(none.shown).toEqual([]);
  expect(none.write).toHaveBeenCalledWith(add);
});

it.each([
  ['a finished cart', { snapshot: snap, terminal: true, incoming: null }],
  [
    'a pending pairing choice',
    { snapshot: snap, terminal: false, incoming: snap },
  ],
])('shows nothing in advance with %s', async (_n, state) => {
  const t = setup(state);
  await t.enqueue(add);
  expect(t.shown).toEqual([]);
});

it('checks the saved request when a write fails and reports the failure', async () => {
  const t = setup({ snapshot: snap, terminal: false, incoming: null });
  t.write.mockRejectedValue(new Error('boom'));
  await expect(t.enqueue(add)).rejects.toThrow('boom');
  expect(t.read).toHaveBeenCalledWith('m');
  expect(t.options.onWriteFailed).toHaveBeenCalled();
});
