export type RedvaultOrderQuote = {
  discountKobo: number;
  eligibleSubtotalKobo: number;
  groups: Array<{
    condition: string | null;
    discountKobo: number;
    key: string;
    lineSubtotalKobo: number;
    members: Array<{
      allocationKobo: number;
      lineId: number;
      quantity: number;
    }>;
    productId: string;
    taxInclusive: false;
    unitPriceKobo: number;
    variantAttributes: Record<string, string>;
    variantId: string | null;
    vatCategoryCode: string;
    vatRateBp: number;
  }>;
  lines: Array<{
    brand: string | null;
    name: string | null;
    unitPriceKobo: number;
    variantAttributes: Record<string, string> | null;
    variantId: string | null;
    vatCategoryCode: string;
    vatRateBp: number;
    condition: string | null;
    discountKobo: number;
    lineId: number;
    productId: string;
    quantity: number;
    unitDiscountsKobo: number[];
  }>;
  productSubtotalKobo: number;
};
