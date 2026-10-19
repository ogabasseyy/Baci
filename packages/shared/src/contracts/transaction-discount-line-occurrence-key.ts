/**
 * Adds the persisted line occurrence to a canonical key when two order lines
 * have the same product, variant, condition, and attributes.
 */
export function buildTransactionDiscountLineOccurrenceKey(
  lineKey: string,
  lineId: number
): string {
  return `${lineKey}#line:${lineId}`;
}
