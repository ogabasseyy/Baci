import type { CartSnapshot } from '@baci/shared/cart';
import { getCartFromStorage, getSharedCartImportReceipt } from './cart-storage';
import { isTerminalCart } from './shared-cart-queue';
import { planLegacyImport } from './shared-cart-reducer';
import type { SharedCartState } from './shared-cart-state';
import { unimportedTerminalLines } from './terminal-cart-cache';

/** Plan device lines for a fresh create, re-planning preserved lines after a terminal reset. */
export function planProvisioningImport(
  merchantSlug: string | null | undefined,
  state: SharedCartState
) {
  const terminal = state.confirmed;
  const isTerminalReset = terminal !== null && isTerminalCart(terminal);
  const stored = getCartFromStorage(merchantSlug);
  // After a mid-session terminal adoption the preserved device lines
  // are still in storage; drop consumed mirrors before re-planning.
  const cached =
    isTerminalReset && terminal
      ? unimportedTerminalLines(
          stored,
          terminal.cartId,
          getSharedCartImportReceipt(merchantSlug)
        )
      : stored;
  const replannable =
    state.importStatus === 'none' ||
    state.importStatus === 'failed' ||
    (state.importStatus === 'skipped' && isTerminalReset);
  return {
    cached,
    isTerminalReset,
    planned:
      replannable && cached.length > 0
        ? planLegacyImport(cached, null, null)
        : null,
    terminal: terminal as CartSnapshot | null,
  };
}
