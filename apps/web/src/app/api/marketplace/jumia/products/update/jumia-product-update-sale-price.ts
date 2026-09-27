export interface SalePriceResult {
  value: number;
  startAt: string | null;
  endAt: string | null;
}

export function resolveSalePrice(
  overrides: {
    jumia_sale_price?: number | null;
    jumia_sale_start?: string | null;
    jumia_sale_end?: string | null;
  },
  mapping: {
    jumia_sale_price: number | null;
    jumia_sale_start: string | null;
    jumia_sale_end: string | null;
  }
): SalePriceResult | undefined {
  if (
    Object.hasOwn(overrides, 'jumia_sale_price') &&
    overrides.jumia_sale_price != null
  ) {
    return {
      value: overrides.jumia_sale_price,
      startAt: Object.hasOwn(overrides, 'jumia_sale_start')
        ? (overrides.jumia_sale_start ?? null)
        : (mapping.jumia_sale_start ?? null),
      endAt: Object.hasOwn(overrides, 'jumia_sale_end')
        ? (overrides.jumia_sale_end ?? null)
        : (mapping.jumia_sale_end ?? null),
    };
  }

  if (
    Object.hasOwn(overrides, 'jumia_sale_price') &&
    overrides.jumia_sale_price == null
  ) {
    return undefined;
  }

  if (
    (Object.hasOwn(overrides, 'jumia_sale_start') ||
      Object.hasOwn(overrides, 'jumia_sale_end')) &&
    mapping.jumia_sale_price != null
  ) {
    return {
      value: mapping.jumia_sale_price,
      startAt: Object.hasOwn(overrides, 'jumia_sale_start')
        ? (overrides.jumia_sale_start ?? null)
        : (mapping.jumia_sale_start ?? null),
      endAt: Object.hasOwn(overrides, 'jumia_sale_end')
        ? (overrides.jumia_sale_end ?? null)
        : (mapping.jumia_sale_end ?? null),
    };
  }

  return undefined;
}
