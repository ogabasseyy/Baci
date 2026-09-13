export const REDVAULT_MAX_ALLOCATION_UNITS_PER_QUOTE = 10_000;

export interface RedvaultAuthoritativeLine {
  brand: string | null;
  condition: string | null;
  itemId: string;
  name: string | null;
  persistedItemOrder: number;
  productId: string;
  quantity: number;
  taxBasis: 'exclusive';
  unitPriceKobo: number;
  variantAttributes: Record<string, string> | null;
  variantId: string | null;
  vatCategoryCode: string;
  vatRateBasisPoints: number;
}

export interface RedvaultItemAllocation {
  discountKobo: number;
  eligible: boolean;
  itemId: string;
  unitDiscountsKobo: number[];
  unitNetAmountsKobo: number[];
}

export interface RedvaultPricingResult {
  allocations: RedvaultItemAllocation[];
  discountKobo: number;
  eligible: boolean;
  eligibleSubtotalKobo: number;
  productSubtotalKobo: number;
}

export interface RedvaultStoredNetAllocation {
  itemId: string;
  unitNetAmountsKobo: number[];
}

export interface RedvaultRefundResult {
  refundKobo: number;
  unitNetAmountsKobo: number[];
}
