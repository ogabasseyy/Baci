import { expect, it } from 'vitest';
import { retryAdoption } from './shared-cart-queue';
import {
  initialSharedCartState,
  type SharedCartState,
} from './shared-cart-state';

it('clears an exhausted adoption error for an explicit retry', () => {
  const state: SharedCartState = {
    ...initialSharedCartState,
    importStatus: 'failed',
    syncError: 'temporarily_unavailable',
  };
  expect(retryAdoption(state)).toMatchObject({
    importStatus: 'none',
    syncError: null,
  });
});
it('preserves unrelated failed command errors', () => {
  const state: SharedCartState = {
    ...initialSharedCartState,
    importStatus: 'failed',
    syncError: 'not_found',
    queue: [
      {
        operationId: 'op',
        state: 'failed',
        attempts: 1,
        intent: { kind: 'clear' },
      },
    ],
  };
  expect(retryAdoption(state).syncError).toBe('not_found');
});
