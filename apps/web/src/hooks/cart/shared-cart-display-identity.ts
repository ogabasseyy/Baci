import { type CartItemIdentity, cartLineIdentity } from '@baci/shared/cart';
import type { SharedCartDisplayItem } from './cart-types';

export interface SharedCartIdentitySource {
  id: string;
  variantId?: string;
  condition?: string;
  variantAttributes?: Record<string, string>;
  selectedColor?: string;
  selectedColorValue?: string;
  secondaryColor?: string;
  secondaryColorValue?: string;
  selectedStorage?: string;
}

export function isCartCondition(
  value: string | undefined
): value is NonNullable<CartItemIdentity['condition']> {
  return (
    value === 'new' ||
    value === 'used' ||
    value === 'open_box' ||
    value === 'refurbished'
  );
}

/**
 * Server identity for a display line. Color/storage selections fold into
 * options so two legacy variants of one product stay distinct lines.
 */
export function cartItemToIdentity(
  item: SharedCartIdentitySource
): CartItemIdentity {
  const options: Record<string, string> = { ...(item.variantAttributes ?? {}) };
  if (item.selectedColor) options.color = item.selectedColor;
  if (item.selectedColorValue) options.colorValue = item.selectedColorValue;
  if (item.secondaryColor) options.secondaryColor = item.secondaryColor;
  if (item.secondaryColorValue) {
    options.secondaryColorValue = item.secondaryColorValue;
  }
  if (item.selectedStorage) options.storage = item.selectedStorage;
  const identity: CartItemIdentity = { productId: item.id };
  if (item.variantId) identity.variantId = item.variantId;
  if (isCartCondition(item.condition)) identity.condition = item.condition;
  if (Object.keys(options).length > 0) identity.options = options;
  return identity;
}

export function identityKeyOfDisplay(item: SharedCartDisplayItem): string {
  return cartLineIdentity(cartItemToIdentity(item));
}

/**
 * Attachment-lane identity for adds: the server merges an add only
 * into the line whose voucher AND negotiation attachments match, so
 * capacity checks and optimistic matching must compare the full lane
 * (negotiated price in minor units, status normalized to 'none').
 */
export function displayLineMatchesAddLane(
  line: SharedCartDisplayItem,
  lane: {
    voucherToken?: string;
    voucherAwardId?: string;
    negotiatedUnitPriceMinor?: number;
    negotiationStatus?: string;
  }
): boolean {
  const lineNegotiatedMinor =
    line.negotiatedPrice != null
      ? Math.round(line.negotiatedPrice * 100)
      : undefined;
  return (
    (line.quizVoucherToken ?? undefined) === lane.voucherToken &&
    (line.quizAwardId ?? undefined) === lane.voucherAwardId &&
    lineNegotiatedMinor === lane.negotiatedUnitPriceMinor &&
    (line.negotiationStatus ?? 'none') === (lane.negotiationStatus ?? 'none')
  );
}
