import { expect, it } from 'vitest';
import { cartItem, snapshot } from './shared-cart-provisioning.test-support';
import {
  initialSharedCartState,
  sharedCartReducer,
} from './shared-cart-reducer';

it('clears capacity warnings when polling adopts a terminal cart', () => {
  const started = sharedCartReducer(initialSharedCartState, {
    cached: [cartItem({ id: 'prod-9', cartItemId: 'prod-9' })],
    generation: 1,
    merchantId: '11111111-1111-4111-8111-111111111111',
    products: {},
    type: 'link/start',
  });
  const linked = sharedCartReducer(started, {
    generation: 1,
    snapshot: snapshot({ lines: [], version: 1 }),
    type: 'link/snapshot',
  });
  const blocked = sharedCartReducer(linked, {
    generation: 1,
    type: 'import/capacity_exceeded',
  });
  expect(blocked.importStatus).toBe('failed');
  expect(blocked.importWarnings).toContain('import_capacity_exceeded');
  const terminal = sharedCartReducer(blocked, {
    generation: 1,
    snapshot: snapshot({ state: 'completed', lines: [], version: 2 }),
    type: 'snapshot/polled',
  });
  expect(terminal.importWarnings).toEqual([]);
  expect(terminal.importStatus).toBe('skipped');
});

it('clears display lines when polling adopts a terminal cart', () => {
  const started = sharedCartReducer(initialSharedCartState, {
    cached: [
      cartItem({ id: 'prod-9', cartItemId: 'prod-9' }),
      cartItem({
        id: 'prod-1',
        cartItemId: 'prod-1',
        serverLineId: 'purchased-line',
      } as never),
    ],
    generation: 1,
    merchantId: '11111111-1111-4111-8111-111111111111',
    products: {},
    type: 'link/start',
  });
  const linked = sharedCartReducer(started, {
    generation: 1,
    snapshot: snapshot({ lines: [], version: 1 }),
    type: 'link/snapshot',
  });
  const terminal = sharedCartReducer(linked, {
    generation: 1,
    snapshot: snapshot({ state: 'completed', lines: [], version: 2 }),
    type: 'snapshot/polled',
  });
  // Display clears on terminal adoption; unimported device lines survive
  // only in the storage cache, where provisioning re-plans them into
  // the next cart (covered by the terminal re-plan suite).
  expect(terminal.unimportedCache).toEqual([]);
  expect(terminal.display).toEqual([]);
  expect(terminal.importStatus).toBe('skipped');
});
