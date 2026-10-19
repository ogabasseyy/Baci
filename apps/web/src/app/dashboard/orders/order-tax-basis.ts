export type OrderTaxBasis = 'exclusive' | 'inclusive';

export function parseOrderTaxBasis(
  value: string | null | undefined
): OrderTaxBasis | undefined {
  return value === 'exclusive' || value === 'inclusive' ? value : undefined;
}
