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
