import { requiresProductSelection } from '@baci/shared/lib';
import { getStorefrontProductHref } from '@/lib/storefront-product-href';
import type { FastCatalogReply } from './fast-catalog-reply';

/** Add only server-owned catalog links to the legacy text transport. */
export function formatFastCatalogText(
  reply: FastCatalogReply,
  currency: string
): string {
  const products = reply.events.flatMap((event) => event.products);
  if (!products.length) return reply.text;

  let formatter: Intl.NumberFormat | undefined;
  try {
    formatter = new Intl.NumberFormat('en-NG', {
      currency,
      style: 'currency',
      maximumFractionDigits: 2,
      minimumFractionDigits: 0,
    });
  } catch {
    // Keep the link useful even when the merchant currency is invalid.
  }

  const lines = products.map((product) => {
    const name = product.name
      .replace(/[\r\n]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const needsPriceSelection = requiresProductSelection({
      available_conditions: product.availableConditions,
      has_condition_offers: product.hasConditionOffers,
      has_variants: product.hasVariants,
      variant_model: product.variantModel,
    });
    const price =
      !needsPriceSelection && formatter
        ? ` — ${formatter.format(product.price)}`
        : '';
    const href = getStorefrontProductHref({
      id: product.id,
      name: product.name,
      slug: product.slug ?? undefined,
      category: product.category,
    });
    return `${name}${price}\nhttps://ogabassey.com${href}`;
  });

  return `${reply.text}\n\n${lines.join('\n\n')}\n\nOpen a product link to check its current options, price and availability.`;
}
