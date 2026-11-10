import type { CartItem } from '@/stores/cart-store.types';
import { createOptimisticCart } from './optimistic-cart-write';

function line(id: string, quantity: number, extra: Partial<CartItem> = {}) {
  return {
    id,
    product_id: `p-${id}`,
    slug: id,
    name: id,
    price: 10,
    quantity,
    ...extra,
  } as CartItem;
}
function setup(items: CartItem[], hasSnapshot = true) {
  const state = { items };
  const cart = createOptimisticCart({
    getItems: () => state.items,
    setItems: (next) => {
      state.items = next;
    },
    hasSnapshot: () => hasSnapshot,
  });
  const exec = jest.fn().mockResolvedValue(undefined);
  return { state, cart, exec };
}

it('changes the quantity on screen before the server answers, clamped to stock', () => {
  const { state, cart, exec } = setup([line('a', 1, { max_quantity: 3 })]);
  void cart.write({ type: 'quantity', id: 'a', quantity: 9 }, exec);
  expect(state.items[0].quantity).toBe(3);
});

it('removes on remove and on a zero quantity', () => {
  const one = setup([line('a', 1), line('b', 1)]);
  void one.cart.write({ type: 'remove', id: 'a' }, one.exec);
  expect(one.state.items.map((i) => i.id)).toEqual(['b']);
  const two = setup([line('a', 1), line('b', 1)]);
  void two.cart.write({ type: 'quantity', id: 'b', quantity: 0 }, two.exec);
  expect(two.state.items.map((i) => i.id)).toEqual(['a']);
});

it('clears the cart on clear', () => {
  const { state, cart, exec } = setup([line('a', 1)]);
  void cart.write({ type: 'clear' }, exec);
  expect(state.items).toEqual([]);
});

it('adds a pending line, or merges into the same line', () => {
  const { state, cart, exec } = setup([line('a', 1)]);
  const { id: _id, ...fresh } = line('z', 2);
  void cart.write({ type: 'add', item: fresh }, exec);
  expect(state.items).toHaveLength(2);
  expect(state.items[1].quantity).toBe(2);
  const { id: _a, ...same } = line('a', 2);
  void cart.write({ type: 'add', item: same }, exec);
  expect(state.items).toHaveLength(2);
  expect(state.items[0].quantity).toBe(3);
});

it('stays out of the way before a shared cart exists', async () => {
  const { state, cart, exec } = setup([line('a', 1)], false);
  const { id: _id, ...fresh } = line('z', 1);
  const actions = [
    { type: 'add', item: fresh } as const,
    { type: 'remove', id: 'a' } as const,
    { type: 'quantity', id: 'a', quantity: 5 } as const,
  ];
  for (const action of actions) {
    await cart.write(action, exec);
    expect(exec).toHaveBeenLastCalledWith(action);
  }
  expect(state.items).toEqual([line('a', 1)]);
});

it('leaves actions it cannot predict to the server reply', () => {
  const { state, cart, exec } = setup([line('a', 1)]);
  void cart.write({ type: 'negotiate', id: 'a', price: 5 }, exec);
  void cart.write({ type: 'assurance', id: 'a' }, exec);
  expect(state.items).toEqual([line('a', 1)]);
});

it('rolls back to the previous lines and rethrows when the server rejects', async () => {
  const before = [line('a', 2)];
  const { state, cart } = setup(before);
  const failure = new Error('rejected');
  await expect(
    cart.write({ type: 'remove', id: 'a' }, () => Promise.reject(failure))
  ).rejects.toBe(failure);
  expect(state.items).toBe(before);
});

it('never overwrites a newer server snapshot when rolling back', async () => {
  const { state, cart } = setup([line('a', 2)]);
  const newer = [line('a', 5)];
  await expect(
    cart.write({ type: 'remove', id: 'a' }, () => {
      state.items = newer;
      return Promise.reject(new Error('rejected'));
    })
  ).rejects.toThrow();
  expect(state.items).toBe(newer);
});

it('sends writes one at a time and in tap order', async () => {
  const { cart, state } = setup([line('a', 1)]);
  const order: string[] = [];
  let release: () => void = () => undefined;
  const first = cart.write({ type: 'quantity', id: 'a', quantity: 2 }, () => {
    order.push('first:start');
    return new Promise<void>((resolve) => {
      release = () => {
        order.push('first:end');
        resolve();
      };
    });
  });
  const second = cart.write(
    { type: 'quantity', id: 'a', quantity: 3 },
    async () => {
      order.push('second');
    }
  );
  await Promise.resolve();
  await Promise.resolve();
  expect(order).toEqual(['first:start']);
  expect(state.items[0].quantity).toBe(3);
  release();
  await Promise.all([first, second]);
  expect(order).toEqual(['first:start', 'first:end', 'second']);
});

it('retargets an edit of a pending line to its confirmed server line', async () => {
  const { state, cart } = setup([line('a', 1)]);
  const { id: _id, ...fresh } = line('z', 1);
  await Promise.resolve();
  const add = cart.write({ type: 'add', item: fresh }, async () => {
    // Server confirms: the pending line is replaced by the real one.
    state.items = [line('a', 1), line('server-z', 1, { product_id: 'p-z' })];
  });
  const pendingId = state.items[1].id;
  const exec = jest.fn().mockResolvedValue(undefined);
  const edit = cart.write(
    { type: 'quantity', id: pendingId, quantity: 4 },
    exec
  );
  await Promise.all([add, edit]);
  expect(exec).toHaveBeenCalledWith({
    type: 'quantity',
    id: 'server-z',
    quantity: 4,
  });
});
