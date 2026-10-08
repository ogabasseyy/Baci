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
  return {
    itemIds: items.map((item) => item.product_id).join(','),
    quantities: new Map(
      items.map((item) => [item.product_id, item.quantity] as const)
    ),
  };
}
