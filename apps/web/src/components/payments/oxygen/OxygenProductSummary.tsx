import { Package } from 'lucide-react';
import { CdnFormatImage } from '@/components/storefront/cdn-format-image';

export interface OxygenCheckoutProduct {
  id: string;
  name: string;
  quantity: number;
  price: number;
  imageUrl?: string | null;
}
export function OxygenProductSummary({
  products,
  currency = 'NGN',
}: {
  products: OxygenCheckoutProduct[];
  currency?: string;
}) {
  if (!products.length) return null;
  const money = (amount: number) =>
    new Intl.NumberFormat('en-NG', {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    }).format(amount);
  function row(item: OxygenCheckoutProduct) {
    const image =
      item.imageUrl && /^https?:\/\//.test(item.imageUrl)
        ? item.imageUrl
        : null;
    return (
      <li key={item.id} className="flex items-center gap-3">
        <div className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-gray-100 bg-white">
          {image ? (
            <CdnFormatImage
              src={image}
              alt={item.name}
              width={56}
              height={56}
              loading="lazy"
              className="size-14 object-contain"
            />
          ) : (
            <Package aria-hidden="true" className="size-6 text-gray-400" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold leading-snug text-gray-900">
            {item.name}
          </p>
          <p className="mt-1 text-xs text-gray-500">
            Qty {item.quantity} · {money(item.price * item.quantity)}
          </p>
        </div>
      </li>
    );
  }
  return (
    <section
      aria-label="Your items"
      className="mb-4 rounded-2xl border border-gray-100 bg-white p-3"
    >
      <ul className="grid gap-3">{products.slice(0, 2).map(row)}</ul>
      {products.length > 2 && (
        <details className="mt-2">
          <summary className="min-h-11 cursor-pointer content-center text-sm text-gray-600">
            {products.length - 2} more items
          </summary>
          <ul className="grid gap-3">{products.slice(2).map(row)}</ul>
        </details>
      )}
    </section>
  );
}
