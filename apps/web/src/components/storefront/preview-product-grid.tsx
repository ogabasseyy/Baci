'use client';

type PreviewProductGridProps = {
  columns?: number;
  limit?: number;
  showFilters?: boolean;
  title?: string;
};

const previewProductCount = 24;
const previewGridColumnClasses: Record<number, string> = {
  1: 'lg:grid-cols-1',
  2: 'lg:grid-cols-2',
  3: 'lg:grid-cols-3',
  4: 'lg:grid-cols-4',
};
const previewProducts = Array.from(
  { length: previewProductCount },
  (_, index) => ({
    id: `preview-product-${index + 1}`,
    name: `Preview Product ${index + 1}`,
    price: `Sample price ${index + 1}`,
  })
);

export function PreviewProductGrid({
  columns = 4,
  limit = 12,
  showFilters = false,
  title = 'Shop By',
}: PreviewProductGridProps) {
  const productLimit = Math.min(Math.max(limit, 1), previewProducts.length);
  const gridColumns = Math.min(Math.max(columns, 1), 4);
  return (
    <section data-fixture-version="v2" data-testid="builder-preview-products">
      <h2>{title}</h2>
      {showFilters ? (
        <fieldset data-testid="builder-preview-product-filters">
          <legend className="sr-only">Preview product filters</legend>
          <button aria-disabled="true" disabled type="button">
            All products
          </button>
          <button aria-disabled="true" disabled type="button">
            Newest
          </button>
        </fieldset>
      ) : null}
      <div
        className={`grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 ${previewGridColumnClasses[gridColumns]}`}
        data-testid="builder-preview-product-grid"
      >
        {previewProducts.slice(0, productLimit).map((product) => (
          <article className="rounded-md border p-4" key={product.id}>
            <div
              aria-hidden="true"
              className="mb-3 aspect-square rounded bg-muted"
            />
            <h3>{product.name}</h3>
            <p>{product.price}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
