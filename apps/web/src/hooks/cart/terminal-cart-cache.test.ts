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
