import type { SharedCartDisplayItem } from './cart-types';
import type { SharedCartImportReceipt } from './shared-cart-storage';
/** A receipt or stable server line ID marks consumed canonical data, not a new device import. */
export function unimportedTerminalLines(
  cached: SharedCartDisplayItem[],
  terminalCartId: string,
  receipt: SharedCartImportReceipt | null
): SharedCartDisplayItem[] {
  if (receipt?.cartId === terminalCartId) return [];
  return cached.filter((line) => !line.serverLineId);
}
