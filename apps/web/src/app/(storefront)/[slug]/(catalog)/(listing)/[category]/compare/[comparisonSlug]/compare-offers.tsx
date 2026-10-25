import { getProductUrl } from '@/lib/product-url';
import {
  getRecord,
  getStructuredDataAvailability,
  toOptionalNumber,
} from './compare-schema-product';

export function CompareOffers({
  products,
  currency,
  baseUrl,
  locale,
}: {
  products: unknown[];
  currency: string;
  baseUrl: string;
  locale: string;
}) {
  const formatter = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  });
  return (
    <section className="mt-8" aria-label="Compared listings">
      <h2 className="text-xl font-semibold">Current listing offers</h2>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        {products.map((product, index) => {
          const record = getRecord(product);
          if (!record) return null;
          const name =
            typeof record.name === 'string'
              ? record.name
              : `Listing ${index + 1}`;
          const price = toOptionalNumber(record.price);
          const availability = getStructuredDataAvailability(record);
          const condition =
            typeof record.condition === 'string' && record.condition.trim()
              ? record.condition
              : 'Not documented';
          const storage = Array.isArray(record.storage)
            ? record.storage.join(', ')
            : typeof record.storage === 'string'
              ? record.storage
              : '';
          const ram = typeof record.ram === 'string' ? record.ram : '';
          const category = getRecord(record.categories);
          const categories = category
            ? {
                name:
                  typeof category.name === 'string' ? category.name : undefined,
                slug:
                  typeof category.slug === 'string' ? category.slug : undefined,
              }
            : undefined;
          const href = new URL(
            getProductUrl({
              id: String(record.id ?? ''),
              name,
              categories,
              slug: typeof record.slug === 'string' ? record.slug : undefined,
              category_slug:
                typeof record.category_slug === 'string'
                  ? record.category_slug
                  : undefined,
              category:
                typeof record.category === 'string'
                  ? record.category
                  : undefined,
              canonical_url:
                typeof record.canonical_url === 'string'
                  ? record.canonical_url
                  : undefined,
            }),
            baseUrl
          ).toString();
          return (
            <article
              className="rounded-2xl border border-store-border p-4"
              key={String(record.id ?? index)}
            >
              <h3 className="font-semibold">{name}</h3>
              <p>
                {price !== null && price > 0
                  ? `Starting price: ${formatter.format(price)}`
                  : 'Price: Not documented'}
              </p>
              <p>Condition: {condition}</p>
              <p>
                Configuration:{' '}
                {[storage, ram].filter(Boolean).join(' / ') ||
                  'Confirm selected variant on product page'}
              </p>
              <p>
                {availability === 'InStock'
                  ? 'In stock'
                  : availability === 'OutOfStock'
                    ? 'Out of stock'
                    : 'Availability: Confirm on product page'}
              </p>
              <a className="text-store-primary underline" href={href}>
                View {name}
              </a>
            </article>
          );
        })}
      </div>
      <p className="mt-3 text-sm">
        Starting offers may cover different conditions and configurations.
        Confirm the selected variant, warranty and delivery terms on each
        listing before checkout.
      </p>
    </section>
  );
}
