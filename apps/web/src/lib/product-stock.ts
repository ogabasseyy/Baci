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

  const stockBucket = getProductStockBucket(item);

  if (filter === 'out_of_stock') {
    return stockBucket === 'out_of_stock';
  }

  if (filter === 'in_stock') {
    return stockBucket !== 'out_of_stock';
  }

  if (filter === 'infinite') {
    return item.manage_stock === false;
  }

  return true;
}

export {
  getEffectiveProductStock,
  getProductLowStockThreshold,
  getProductStockBucket,
};
