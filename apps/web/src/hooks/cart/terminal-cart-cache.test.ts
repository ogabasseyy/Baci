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
it('aggregates duplicate consumed IDs before computing the delta', () => {
  const first = cartItem({ cartItemId: 'dup', quantity: 4 });
  const second = cartItem({ cartItemId: 'dup', quantity: 3 });
  // Source rows were 2 + 3 = 5 for the same deterministic ID; the
  // cache now totals 7, so only 2 units are genuinely post-import.
  expect(
    unimportedTerminalLines([first, second], 'done', {
      cartId: 'done',
      importedAt: '2026-10-20T00:00:00Z',
      lineCount: 2,
      consumedCartItemIds: ['dup'],
      consumedQuantities: { dup: 5 },
    })
  ).toEqual([{ ...first, quantity: 2 }]);
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

it('checkpoints a persisted filter so re-filtering retains the remainder', async () => {
  const { terminalConsumptionCheckpoint, unimportedTerminalLines } =
    await import('./terminal-cart-cache');
  const receipt = {
    cartId: 'cart-1',
    importedAt: '2026-10-26T00:00:00.000Z',
    lineCount: 1,
    consumedCartItemIds: ['prod-1'],
    consumedQuantities: { 'prod-1': 1 },
  } as never;
  const cached = [{ cartItemId: 'prod-1', quantity: 3 }] as never;
  const filtered = unimportedTerminalLines(cached, 'cart-1', receipt);
  expect(filtered).toHaveLength(1);
  expect(filtered[0].quantity).toBe(2);
  const checkpoint = terminalConsumptionCheckpoint(receipt, 'cart-1');
  const refiltered = unimportedTerminalLines(
    filtered as never,
    'cart-1',
    checkpoint
  );
  expect(refiltered).toHaveLength(1);
  expect(refiltered[0].quantity).toBe(2);
});

it('verifies a persisted consumption checkpoint', async () => {
  const { terminalCheckpointPersisted } = await import('./terminal-cart-cache');
  expect(
    terminalCheckpointPersisted(
      {
        cartId: 'cart-1',
        importedAt: '2026-10-26T00:00:00.000Z',
        lineCount: 0,
        consumedQuantities: { 'prod-1': 0 },
      } as never,
      'cart-1'
    )
  ).toBe(true);
  expect(
    terminalCheckpointPersisted(
      {
        cartId: 'cart-1',
        importedAt: '2026-10-26T00:00:00.000Z',
        lineCount: 1,
        consumedQuantities: { 'prod-1': 1 },
      } as never,
      'cart-1'
    )
  ).toBe(false);
});
