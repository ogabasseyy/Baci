type PricedSearchProduct = { displayPrice?: number | null };

export function selectSearchProductsByPrice<T extends PricedSearchProduct>(
  products: readonly T[],
  args: { min_price?: number; max_price?: number; sort?: string },
  limit: number
): T[] {
  const selected = products.filter(({ displayPrice }) => {
    if (typeof displayPrice !== 'number' || !Number.isFinite(displayPrice)) return false;
    if (args.min_price === undefined && args.max_price === undefined &&
      args.sort !== 'price_asc' && args.sort !== 'price_desc') return true;
    return (args.min_price === undefined || displayPrice >= args.min_price) &&
      (args.max_price === undefined || displayPrice <= args.max_price);
  });

  if (args.sort === 'price_asc' || args.sort === 'price_desc') {
    const direction = args.sort === 'price_asc' ? 1 : -1;
    selected.sort((left, right) => {
      const leftPrice = left.displayPrice;
      const rightPrice = right.displayPrice;
      const leftKnown = typeof leftPrice === 'number' && Number.isFinite(leftPrice);
      const rightKnown = typeof rightPrice === 'number' && Number.isFinite(rightPrice);
      if (!leftKnown && !rightKnown) return 0;
      if (!leftKnown) return 1;
      if (!rightKnown) return -1;
      return direction * (leftPrice - rightPrice);
    });
  }

  return selected.slice(0, limit);
}
