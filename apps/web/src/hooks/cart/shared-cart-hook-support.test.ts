import { expect, it } from 'vitest';
import {
  backoffMs,
  buildCommand,
  resolveCommandTarget,
} from './shared-cart-hook-support';
import { initialSharedCartState } from './shared-cart-state';

it('never sends a temporary remove before the add has a confirmed line', () => {
  expect(
    resolveCommandTarget({ kind: 'temp', tempId: 'pending' }, null)
  ).toBeNull();
  expect(
    buildCommand(
      { kind: 'remove', target: { kind: 'temp', tempId: 'pending' } },
      initialSharedCartState
    )
  ).toBeNull();
});
it('bounds repeated retry delay', () => {
  expect(backoffMs(1000, 100)).toBe(30000);
});

it('submits a delegated add with the exact offer id', () => {
  const offerId = '44444444-4444-4444-8444-444444444444';
  const command = buildCommand(
    {
      kind: 'add',
      options: { condition: 'used', offerId },
      product: { id: '11111111-1111-4111-8111-111111111111' },
      quantity: 1,
    } as never,
    initialSharedCartState
  );
  expect(command).toMatchObject({
    item: {
      condition: 'used',
      offerId,
      productId: '11111111-1111-4111-8111-111111111111',
    },
    quantity: 1,
    type: 'add',
  });
});
