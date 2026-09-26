interface ProductStockSource {
  has_condition_offers?: boolean | null;
  has_variants?: boolean | null;
  manage_stock?: boolean | null;
  stock_quantity?: number | null;
}

interface VariantStockSource {
  stock_quantity?: number | null;
}

export function getMcpProductStockSummary(
  source: ProductStockSource,
  variants?: readonly VariantStockSource[],
  offers?: readonly VariantStockSource[]
) {
  const managesStock = source.manage_stock === true;

  if (!managesStock) {
    return {
      confidence: 'unconfirmed',
      inStock: null,
      level: 'Confirm availability',
    };
  }

  const knownStock = source.has_variants === true
    ? (variants ?? []).reduce((total, variant) => total + Math.max(0, Number(variant.stock_quantity ?? 0)), 0)
    : Math.max(0, Number(source.stock_quantity ?? 0));
  const offerStock = (offers ?? []).reduce((total, offer) => total + Math.max(0, Number(offer.stock_quantity ?? 0)), 0);
  // The parent quantity may already include offer inventory; avoid double counting.
  const stockQuantity = Math.max(knownStock, offerStock);

  if (stockQuantity === 0 &&
    ((source.has_variants === true && variants === undefined) ||
      (source.has_condition_offers === true && offers === undefined))) {
    return {
      confidence: 'unconfirmed',
      inStock: null,
      level: 'Confirm availability',
    };
  }

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
