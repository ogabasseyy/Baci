/**
 * Server-authored discount provenance persisted with an order.  Product and
 * variant identity are copied into `order_items` by the storefront-order RPC,
 * so consumers do not depend on the order in which Supabase returns the
 * embedded relation. `lineId` remains the request ordinal for backwards
 * compatibility and diagnostics; it is not the persisted matching key.
 */
export const TRANSACTION_DISCOUNT_METADATA_KEY = 'baci_transaction_discount';

export interface TransactionDiscountLineAllocation {
  lineId: number;
  /** Present in version 3; omitted by legacy version-2 metadata. */
  productId?: string;
  /** Present in version 3; omitted by legacy version-2 metadata. */
  variantId?: string | null;
  /** Present when product/variant alone cannot uniquely identify a line. */
  lineKey?: string;
  merchandiseDiscount: number;
  vatRelief: number;
}

export interface TransactionDiscountMetadata {
  lineDiscounts: Array<TransactionDiscountLineAllocation | null>;
  version: 3;
}
