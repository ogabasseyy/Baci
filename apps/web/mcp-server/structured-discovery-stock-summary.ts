import { getEffectiveStock } from '../src/lib/product-stock';
import { getMcpProductStockSummary } from './product-stock-summary';

interface ParentStock {
  manage_stock?: boolean | null;
  stock?: number | null;
  stock_quantity?: number | null;
}

interface ProductStockSource extends Record<string, unknown> {
  manage_stock?: boolean | null;
  stock_quantity?: number | null;
}

export function getStructuredDiscoveryStockSummary(input: {
  product: ProductStockSource;
  parentStock: ParentStock;
  kind: 'base' | 'variant' | 'offer';
  pairedVariant?: Record<string, unknown>;
  selectedPolicy?: unknown;
  selectedStockQuantity?: unknown;
}) {
  const { product, parentStock, kind, pairedVariant, selectedPolicy, selectedStockQuantity } = input;
  const pairedOffer = kind === 'offer' && pairedVariant !== undefined;
  const childStock = (rawQuantity: unknown) => {
    const quantity = Number(rawQuantity == null ? getEffectiveStock(parentStock) : rawQuantity);
    return Number.isFinite(quantity) && quantity >= 0 ? quantity : null;
  };
  const explicitStock = (rawQuantity: unknown) => {
    const quantity = Number(rawQuantity ?? 0);
    return Number.isFinite(quantity) && quantity >= 0 ? quantity : null;
  };
  const stockQuantity = kind === 'base'
    ? explicitStock(product.stock_quantity)
    : pairedOffer
      ? childStock(pairedVariant.stock_quantity) ?? 0
      : 0;

  return getMcpProductStockSummary({
    ...product,
    manage_stock: selectedPolicy === 'serialized_strict' ? true : parentStock.manage_stock,
    has_variants: kind === 'variant',
    has_condition_offers: kind === 'offer' && !pairedOffer,
    stock_quantity: stockQuantity,
  }, kind === 'variant' ? [{ stock_quantity: childStock(selectedStockQuantity) }] : undefined,
  kind === 'offer' && !pairedOffer ? [{ stock_quantity: explicitStock(selectedStockQuantity) }] : undefined);
}
