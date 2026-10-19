type OrderItemProduct = {
  weight_value?: number | null;
  weight_unit?: string | null;
  commodity_code?: string | null;
  dimensions?: unknown;
};

type OrderItemWithProduct = {
  product_id?: string | null;
  product?: OrderItemProduct | OrderItemProduct[] | null;
};

function normalizeOrderItemProduct(
  product: OrderItemWithProduct['product']
): OrderItemProduct | null {
  if (!product) return null;
  return Array.isArray(product) ? (product[0] ?? null) : product;
}

export function buildAdminOrderGiglProductLookup(
  items: OrderItemWithProduct[]
): Record<
  string,
  {
    weight_value: number | null;
    weight_unit: string | null;
    commodity_code: string | null;
    dimensions: unknown;
  }
> {
  return Object.fromEntries(
    items.flatMap((item) => {
      const productId = item.product_id;
      if (!productId) return [];
      const product = normalizeOrderItemProduct(item.product);
      return [
        [
          productId,
          {
            weight_value: product?.weight_value ?? null,
            weight_unit: product?.weight_unit ?? null,
            commodity_code: product?.commodity_code ?? null,
            dimensions: product?.dimensions ?? null,
          },
        ],
      ];
    })
  );
}

export function mapAdminOrderGiglQuoteItems(items: OrderItemWithProduct[]) {
  return items.map((item) => {
    const product = normalizeOrderItemProduct(item.product);
    return {
      ...item,
      weight_value: product?.weight_value ?? null,
      weight_unit: product?.weight_unit ?? null,
    };
  });
}
