import { getCartCookieEpoch } from './cart-cross-tab-lock';
import type { SharedCartAction } from './shared-cart-state';

/** Surface unavailable coordination without authorizing an unsafe fallback. */
export function reportCartCookieStorageFailure(
  dispatch: (action: SharedCartAction) => void,
  generation: number,
  operationId?: string
): boolean {
  if (getCartCookieEpoch() !== undefined) return false;
  dispatch(
    operationId
      ? {
          generation,
          type: 'command/failed',
          operationId,
          code: 'temporarily_unavailable',
          retryable: true,
        }
      : { generation, type: 'import/failed', code: 'temporarily_unavailable' }
  );
  return true;
}
