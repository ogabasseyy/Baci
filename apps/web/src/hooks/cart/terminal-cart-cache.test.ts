import { expect, it } from 'vitest';
import { cartItem } from './shared-cart-provisioning.test-support';
import { unimportedTerminalLines } from './terminal-cart-cache';

it('does not recreate lines already consumed by the terminal cart receipt', () => {
  expect(
    unimportedTerminalLines([cartItem()], 'done', {
      cartId: 'done',
      importedAt: '2026-10-20T00:00:00Z',
      lineCount: 1,
    })
  ).toEqual([]);
});
it('filters consumed lines by stable device-line identity, ignoring order and counts', () => {
  const consumedA = cartItem({ id: 'a', cartItemId: 'line-a' });
  const consumedB = cartItem({ id: 'b', cartItemId: 'line-b' });
  const fresh = cartItem({ id: 'new', cartItemId: 'line-new' });
  // Reordered source lines ahead of the fresh line: a positional count
  // would drop the fresh line or resurrect a consumed one.
  expect(
    unimportedTerminalLines([fresh, consumedB, consumedA], 'done', {
      cartId: 'done',
      importedAt: '2026-10-20T00:00:00Z',
      lineCount: 1,
      consumedCartItemIds: ['line-a', 'line-b'],
    })
  ).toEqual([fresh]);
});
it('keeps only the post-import quantity increase for a consumed line ID', () => {
  const edited = cartItem({ cartItemId: 'line-a', quantity: 5 });
  expect(
    unimportedTerminalLines([edited], 'done', {
      cartId: 'done',
      importedAt: '2026-10-20T00:00:00Z',
      lineCount: 1,
      consumedCartItemIds: ['line-a'],
      consumedQuantities: { 'line-a': 2 },
    })
  ).toEqual([{ ...edited, quantity: 3 }]);
});
it('keeps fresh device lines written after a matching receipt', () => {
  const fresh = cartItem({ id: 'new', cartItemId: 'new' });
  expect(
    unimportedTerminalLines(
      [{ ...cartItem(), serverLineId: 'consumed' }, fresh],
      'done',
      { cartId: 'done', importedAt: '2026-10-20T00:00:00Z', lineCount: 1 }
    )
  ).toEqual([fresh]);
});
it('keeps only genuinely unimported lines when a receipt belongs to another cart', () => {
  const fresh = cartItem({ id: 'new', cartItemId: 'new' });
  expect(
    unimportedTerminalLines(
      [{ ...cartItem(), serverLineId: 'consumed' }, fresh],
      'done',
      null
    )
  ).toEqual([fresh]);
});
