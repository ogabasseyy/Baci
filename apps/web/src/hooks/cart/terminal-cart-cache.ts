import type { SharedCartDisplayItem } from './cart-types';
import type { SharedCartImportReceipt } from './shared-cart-storage';
/** A stable server line ID marks consumed canonical data, not a new device import. */
export function unimportedTerminalLines(
  cached: SharedCartDisplayItem[],
  terminalCartId: string,
  receipt: SharedCartImportReceipt | null
): SharedCartDisplayItem[] {
  const fresh = cached.filter((line) => !line.serverLineId);
  if (receipt?.cartId !== terminalCartId) return fresh;
  // A matching receipt consumes the imported source set, but fresh
  // device-only writes after the import still lack a server line ID.
  // A pure source cache (no mirrors) matching the receipt count is
  // fully consumed; a mixed cache keeps its post-import writes.
  const mirrors = cached.length - fresh.length;
  if (mirrors > 0) return fresh;
  if (fresh.length <= receipt.lineCount) return [];
  return fresh.slice(receipt.lineCount);
}
