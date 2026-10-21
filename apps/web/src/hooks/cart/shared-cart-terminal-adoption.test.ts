import { expect, it } from 'vitest';
import { cartItem, snapshot } from './shared-cart-provisioning.test-support';
import {
  initialSharedCartState,
  sharedCartReducer,
} from './shared-cart-reducer';

it('preserves unimported device lines when polling adopts a terminal cart', () => {
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
  // The never-imported line survives for the next cart; the consumed
  // mirror (stable server line id) does not.
  expect(terminal.unimportedCache.map((line) => line.id)).toEqual(['prod-9']);
  expect(terminal.display.map((line) => line.id)).toContain('prod-9');
});
