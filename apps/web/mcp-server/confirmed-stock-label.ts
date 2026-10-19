/** Shared by the premium widget and the serialized inline fallback. Keep closure-free. */
export function getConfirmedStockLabel(
  inStock: boolean | null | undefined,
  stockLevel?: string
): string | null {
  if (typeof inStock !== 'boolean') return null;
  return stockLevel || (inStock ? 'In Stock' : 'Out of Stock');
}
