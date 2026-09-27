export interface RelatedBlogOfferStockRow {
  compare_at_price?: number | string | null;
  condition?: string | null;
  price?: number | string | null;
  status?: string | null;
  stock_quantity?: number | string | null;
}

export function isOfferStockRow(
  value: unknown
): value is RelatedBlogOfferStockRow {
  return typeof value === 'object' && value !== null;
}
