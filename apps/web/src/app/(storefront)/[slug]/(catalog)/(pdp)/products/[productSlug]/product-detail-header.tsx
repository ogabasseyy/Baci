import type { Product } from '@/lib/products';

/**
 * PDP header: title, SKU, fulfillment requirements, price, and
 * description. Split from ProductDetailClient (modularity rule).
 */
export function ProductDetailHeader({
  product,
  formatCurrency,
  currentPrice,
  currentCompareAtPrice,
}: {
  product: Product;
  formatCurrency: (value: number) => string;
  currentPrice: number;
  currentCompareAtPrice: number | null | undefined;
}) {
  return (
    <>
      <div>
        <h1
          className="text-3xl lg:text-4xl font-bold font-headline"
          style={{ color: 'var(--store-primary)' }}
        >
          {product.name}
        </h1>

        {/* SKU / MPN Display */}
        {(product.sku || product.mpn) && (
          <p className="text-sm text-muted-foreground mt-1">
            SKU: {product.sku || product.mpn}
          </p>
        )}

        {product.fulfillmentFields && product.fulfillmentFields.length > 0 && (
          <div className="text-sm text-gray-500 mt-2">
            <p className="font-medium">Requires:</p>
            <ul className="list-disc list-inside">
              {product.fulfillmentFields.map((field) => (
                <li key={field.name}>{field.name}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex items-baseline gap-3 mt-2">
          <p
            className="text-3xl font-bold"
            style={{ color: 'var(--store-secondary)' }}
          >
            {formatCurrency(currentPrice)}
          </p>
          {currentCompareAtPrice && currentCompareAtPrice > currentPrice && (
            <p className="text-lg text-muted-foreground line-through decoration-red-500/50">
              {formatCurrency(currentCompareAtPrice)}
            </p>
          )}
        </div>
      </div>

      <div className="prose prose-sm text-muted-foreground text-lg leading-relaxed">
        <p>{product.description}</p>
      </div>
    </>
  );
}
