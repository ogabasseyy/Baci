interface ProductStockSource {
  manage_stock?: boolean | null;
  stock_quantity?: number | null;
}

export function getMcpProductStockSummary(source: ProductStockSource) {
  const stockQuantity =
    typeof source.stock_quantity === 'number' ? source.stock_quantity : 0;
  const managesStock = source.manage_stock === true;

  if (!managesStock) {
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
