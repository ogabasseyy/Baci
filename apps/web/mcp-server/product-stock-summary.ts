interface ProductStockSource {
  has_variants?: boolean | null;
  manage_stock?: boolean | null;
  stock_quantity?: number | null;
}

interface VariantStockSource {
  stock_quantity?: number | null;
}

export function getMcpOfferAvailability(manageStock: boolean | null | undefined, quantity: number | null | undefined) {
  if (manageStock !== true) return { availability: 'unconfirmed', label: 'Confirm availability' };
  return Number(quantity ?? 0) > 0
    ? { availability: 'in_stock', label: 'In Stock' }
    : { availability: 'out_of_stock', label: 'Out of Stock' };
}

export function getMcpProductStockSummary(
  source: ProductStockSource,
  variants?: readonly VariantStockSource[]
) {
  const managesStock = source.manage_stock === true;

  if (!managesStock) {
    return {
      confidence: 'unconfirmed',
      inStock: null,
      level: 'Confirm availability',
    };
  }

  if (source.has_variants === true && variants === undefined) {
    return {
      confidence: 'unconfirmed',
      inStock: null,
      level: 'Confirm availability',
    };
  }

  const stockQuantity = source.has_variants === true
    ? (variants ?? []).reduce((total, variant) => total + Math.max(0, Number(variant.stock_quantity ?? 0)), 0)
    : typeof source.stock_quantity === 'number' ? source.stock_quantity : 0;

  if (stockQuantity > 10) {
    return {
      confidence: 'high',
      inStock: true,
      level: 'High Stock',
    };
  }

  if (stockQuantity > 5) {
    return {
      confidence: 'low',
      inStock: true,
      level: 'Low Stock',
    };
  }

  if (stockQuantity > 0) {
    return {
      confidence: 'low',
      inStock: true,
      level: 'Last Units',
    };
  }

  return {
    confidence: 'none',
    inStock: false,
    level: 'Out of Stock',
  };
}
