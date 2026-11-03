import {
  getEffectiveProductStock,
  getProductLowStockThreshold,
  getProductStockBucket,
  type ProductStockBucket,
} from '../../../../packages/shared/src/lib/product-inventory';

export interface StockLike {
  stock?: number | string | null;
  stock_quantity?: number | string | null;
}

export interface ManagedStockLike extends StockLike {
  manage_stock?: boolean | null;
  low_stock_threshold?: number | string | null;
}

export type ProductStockFilter =
  | 'All'
  | 'in_stock'
  | 'out_of_stock'
  | 'infinite';
export type { ProductStockBucket };

export function getEffectiveStock(item: StockLike): number {
  return getEffectiveProductStock(item);
}

export function matchesProductStockFilter(
  item: ManagedStockLike,
  filter: ProductStockFilter | string
): boolean {
  if (filter === 'All') {
    return true;
  }

  // Consistent with PDP purchasability (20261008130001_search_price_options_null_stock_managed.sql):
  // only explicit manage_stock === false is unmanaged/infinite.
  // When manage_stock is true, null, or undefined, inventory is tracked.
  const isUnmanaged = item.manage_stock === false;

  if (filter === 'infinite') {
    return isUnmanaged;
  }

  if (isUnmanaged) {
    if (filter === 'in_stock') return true;
    if (filter === 'out_of_stock') return false;
    return true;
  }

  const stock = getEffectiveProductStock(item);
  if (filter === 'out_of_stock') {
    return stock <= 0;
  }

  if (filter === 'in_stock') {
    return stock > 0;
  }

  return true;
}

export {
  getEffectiveProductStock,
  getProductLowStockThreshold,
  getProductStockBucket,
};
