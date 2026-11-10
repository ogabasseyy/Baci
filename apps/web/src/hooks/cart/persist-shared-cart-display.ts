import {
  saveCartToStorage,
  stripUnconfirmedDisplayLines,
} from './cart-storage';
import type { SharedCartState } from './shared-cart-state';
/** Never persist the previous merchant's cart or an unresolved legacy import. */
export function persistSharedCartDisplay(input: {
  enabled: boolean;
  merchantSlug?: string | null;
  sessionGeneration: number;
  generation: number;
  importStatus: SharedCartState['importStatus'];
  display: SharedCartState['display'];
}) {
  if (
    !input.enabled ||
    input.generation !== input.sessionGeneration ||
    (input.importStatus !== 'done' && input.importStatus !== 'skipped')
  )
    return;
  saveCartToStorage(
    stripUnconfirmedDisplayLines(input.display),
    input.merchantSlug
  );
}
