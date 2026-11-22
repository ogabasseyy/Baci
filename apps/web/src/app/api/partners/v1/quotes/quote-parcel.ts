import { calculateAgenticLineTax } from '@/lib/agentic/agentic-line-tax';
import { readPackageDimensionsCm } from '@/lib/shipping/package-dimensions';
import { productWeightToKg } from '@/lib/shipping/product-weight-to-kg';
import type { ShipmentItem } from '@/lib/shipping/types';

type QuoteLine = {
  product_id: string;
  title: string;
  quantity: number;
  base_unit_price_minor: number;
};

type ParcelProduct = {
  id: string;
  name?: string;
  weight_value?: number | string | null;
  weight_unit?: string | null;
  dimensions?: unknown;
  vat_category_code?: string | null;
  vat_rate?: number | string | null;
};

export function buildPartnerQuoteParcel(
  lines: readonly QuoteLine[],
  products: readonly ParcelProduct[],
  vatRegistered: boolean
) {
  const byId = new Map(products.map((product) => [product.id, product]));
  const items: ShipmentItem[] = [];
  let taxMinor = 0;

  for (const line of lines) {
    const product = byId.get(line.product_id);
    if (!product) return null;

    const basePrice = line.base_unit_price_minor / 100;
    items.push({
      name: product.name ?? line.title,
      quantity: line.quantity,
      value: basePrice,
      weight: productWeightToKg(product.weight_value, product.weight_unit) ?? 1,
      ...readPackageDimensionsCm(product.dimensions),
    });
    taxMinor += Math.round(
      calculateAgenticLineTax({
        productId: product.id,
        price: basePrice,
        quantity: line.quantity,
        vatRate: product.vat_rate,
        vatCategoryCode: product.vat_category_code,
        vatRegistered,
      }) * 100
    );
  }
  return { items, taxMinor };
}
