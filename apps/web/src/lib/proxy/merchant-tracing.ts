import { trace } from '@opentelemetry/api';

/** Adds resolved storefront identity to the active edge span when one exists. */
export function annotateMerchantTrace(
  slug: string | null,
  domain: string
): void {
  const activeSpan = trace.getActiveSpan();
  if (!activeSpan) return;

  if (slug) activeSpan.setAttribute('merchant.slug', slug);
  if (domain) activeSpan.setAttribute('merchant.domain', domain);
}
