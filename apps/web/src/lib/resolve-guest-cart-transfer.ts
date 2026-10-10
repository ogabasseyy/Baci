import { parseGuestCartHandoff } from './guest-cart-handoff';

export interface GuestCartTransfer {
  itemIds: string;
  quantities: Map<string, number>;
}

/** Parses the `guest_cart` URL value into website transfer inputs. */
export function resolveGuestCartTransfer(
  raw: string | null
): GuestCartTransfer | null {
  const items = parseGuestCartHandoff(raw);
  if (!items) return null;
  // UUID text is case-insensitive: canonicalize so handoff ids match the
  // lowercase ids the catalog returns when looking up quantities.
  const ids = items.map((item) => item.product_id.toLowerCase());
  return {
    itemIds: ids.join(','),
    quantities: new Map(
      items.map((item, index) => [ids[index], item.quantity] as const)
    ),
  };
}
