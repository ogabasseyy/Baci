const STOREFRONT_ORDER_LINE_ORDINAL_FIELD = '__baci_line_ordinal';

export function addStorefrontOrderLineOrdinals<T extends object>(
  items: readonly T[]
): Array<T & { __baci_line_ordinal: number }> {
  return items.map((item, index) => ({
    ...item,
    [STOREFRONT_ORDER_LINE_ORDINAL_FIELD]: index + 1,
  }));
}
