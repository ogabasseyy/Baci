import type { CartItem } from '@/stores/cart-store.types';
import { createPendingEdits, stripPendingLines } from './pending-edits';

const line = (id: string, product: string, quantity = 1): CartItem => ({
  id,
  product_id: product,
  slug: product,
  name: product,
  price: 5,
  quantity,
});
const { id: _id, ...bare } = line('x', 'a');

it('replays waiting edits over each confirmed snapshot', () => {
  const shown: CartItem[][] = [];
  const edits = createPendingEdits((items) => shown.push(items));
  edits.confirm([line('l1', 'a', 1)]);
  edits.begin({ type: 'quantity', id: 'l1', quantity: 3 });
  expect(shown.at(-1)?.[0].quantity).toBe(3);
  expect(edits.confirm([line('l1', 'a', 2)])[0].quantity).toBe(3);
});

it('reverts to the confirmed lines only while edits wait', () => {
  const edits = createPendingEdits(() => undefined);
  edits.confirm([line('l1', 'a')]);
  expect(edits.revert()).toBeNull();
  const edit = edits.begin({ type: 'remove', id: 'l1' });
  expect(edits.revert()).toEqual([line('l1', 'a')]);
  edits.settle(edit);
  expect(edits.revert()).toBeNull();
});

it('resolves a pending line to the real one and reports a missing one', () => {
  const edits = createPendingEdits(() => undefined);
  edits.confirm([]);
  const add = edits.begin({ type: 'add', item: bare });
  const pendingId = add.pendingId;
  expect(edits.resolve({ type: 'remove', id: pendingId })).toBeNull();
  edits.confirm([line('real', 'a')]);
  expect(edits.resolve({ type: 'remove', id: pendingId })).toEqual({
    type: 'remove',
    id: 'real',
  });
});

it('keeps a pinned pending line resolvable after its add settles', () => {
  const edits = createPendingEdits(() => undefined);
  edits.confirm([]);
  const add = edits.begin({ type: 'add', item: bare });
  const unpin = edits.pin({ type: 'assurance', id: add.pendingId });
  edits.confirm([line('real', 'a')]);
  edits.settle(add);
  expect(edits.resolve({ type: 'assurance', id: add.pendingId })).toEqual({
    type: 'assurance',
    id: 'real',
  });
  unpin();
});

it('strips predicted lines', () => {
  const items = [line('pending-line::1', 'a'), line('real', 'b')];
  expect(stripPendingLines(items).map((i) => i.id)).toEqual(['real']);
});

it('matches the confirmed line by server identity even when display-only fields differ', () => {
  const edits = createPendingEdits(() => undefined);
  edits.confirm([]);
  const add = edits.begin({
    type: 'add',
    item: { ...bare, offer_id: 'condition-offer-1' },
  });
  edits.confirm([line('real', 'a')]);
  expect(
    edits.resolve({ type: 'quantity', id: add.pendingId, quantity: 3 })
  ).toEqual({
    type: 'quantity',
    id: 'real',
    quantity: 3,
  });
});

it('still resolves a pending line held by a confirmation after its add settled', () => {
  const edits = createPendingEdits(() => undefined);
  edits.confirm([]);
  const add = edits.begin({ type: 'add', item: bare });
  const held = add.pendingId;
  edits.confirm([line('real', 'a')]);
  edits.settle(add);
  expect(edits.resolve({ type: 'remove', id: held })).toEqual({
    type: 'remove',
    id: 'real',
  });
});

it('forgets remembered pending lines when the cart is reset', () => {
  const edits = createPendingEdits(() => undefined);
  edits.confirm([]);
  const add = edits.begin({ type: 'add', item: bare });
  edits.settle(add);
  edits.reset([line('real', 'a')]);
  expect(edits.resolve({ type: 'remove', id: add.pendingId })).toBeNull();
});
