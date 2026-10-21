export interface ComparisonFacts {
  id: string;
  category?: string;
  specifications?: Record<string, string>;
}
/** Missing facts remain unknown. No inferred values or winner scores. */
export function buildComparisonRows(products: readonly ComparisonFacts[]) {
  const keys = [
    ...new Set(products.flatMap((p) => Object.keys(p.specifications ?? {}))),
  ];
  return keys.map((label) => ({
    label,
    values: products.map((p) => p.specifications?.[label]?.trim() || null),
  }));
}
