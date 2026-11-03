import { act, renderHook } from '@testing-library/react';
import { beforeEach, expect, it } from 'vitest';
import { saveSharedCartImportReceipt } from './cart-storage';
import { importInitialDeviceCart } from './shared-cart-initial-import';
import {
  cartItem,
  MERCHANT_ID,
  SLUG,
  snapshot,
} from './shared-cart-provisioning.test-support';
import { useSharedCartRuntime } from './use-shared-cart-runtime';

beforeEach(() => window.localStorage.clear());
function setup() {
  const hook = renderHook(() =>
    useSharedCartRuntime({
      merchantId: MERCHANT_ID,
      merchantSlug: SLUG,
      sessionGeneration: 1,
    })
  );
  act(() =>
    hook.result.current.dispatch({
      type: 'link/start',
      generation: 1,
      merchantId: MERCHANT_ID,
      cached: [],
      products: {},
    })
  );
  return hook;
}
it('skips an empty device cache without enqueuing mutations', () => {
  const { result } = setup();
  act(() =>
    importInitialDeviceCart(result.current, snapshot(), [], 1, () => true)
  );
  expect(result.current.state.importStatus).toBe('skipped');
});
it('recognizes the receipt for this server cart instead of importing twice', () => {
  const current = snapshot();
  saveSharedCartImportReceipt(SLUG, {
    cartId: current.cartId,
    importedAt: '2026-10-20T00:00:00Z',
    lineCount: 1,
  });
  const { result } = setup();
  act(() =>
    importInitialDeviceCart(
      result.current,
      current,
      [cartItem()],
      1,
      () => true
    )
  );
  expect(result.current.state.importStatus).toBe('done');
});
it('leaves import untouched after the lifecycle is canceled', () => {
  const { result } = setup();
  act(() =>
    importInitialDeviceCart(
      result.current,
      snapshot(),
      [cartItem()],
      1,
      () => false
    )
  );
  expect(result.current.state.importStatus).toBe('none');
});
