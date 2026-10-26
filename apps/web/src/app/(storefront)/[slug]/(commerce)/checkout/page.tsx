import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { CheckoutThemeProvider } from '@/components/checkout-theme-provider';
import { NewTemplateCheckoutPage } from '@/components/storefront/new-template';
import { CheckoutCartCapacityGate } from '@/components/storefront/ogabassey/pages/checkout/components/CheckoutCartCapacityGate';
import { CheckoutPage as OgabasseyCheckoutPage } from '@/components/storefront/ogabassey/pages/checkout-page';
import {
  getCachedMerchant,
  getCachedMerchantByDomain,
} from '@/lib/cached-data';
import { isDomainIdentifier } from '@/lib/validation';

export const metadata: Metadata = {
  title: 'Checkout',
  description: 'Complete your private storefront checkout securely.',
  robots: { index: false, follow: false },
};

export default async function CheckoutPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const merchant = isDomainIdentifier(slug)
    ? await getCachedMerchantByDomain(slug)
    : await getCachedMerchant(slug);

  if (!merchant) {
    notFound();
  }

  // Check for new template
  if (
    (merchant as unknown as { template_id?: string }).template_id ===
    'new-template'
  ) {
    // This template reads only the live cart/local steps; it has no orderId
    // lookup or validated resumed-order path, so no resume bypass applies.
    return (
      <CheckoutThemeProvider>
        <CheckoutCartCapacityGate
          cartHref={isDomainIdentifier(slug) ? '/cart' : `/${slug}/cart`}
        >
          <Suspense fallback={<p role="status">Loading checkout…</p>}>
            <NewTemplateCheckoutPage />
          </Suspense>
        </CheckoutCartCapacityGate>
      </CheckoutThemeProvider>
    );
  }

  // Ogabassey Template (or any template that doesn't have a custom checkout)
  // Default to ogabassey checkout as it's the fully functional implementation
  return (
    <CheckoutThemeProvider>
      <Suspense fallback={<p role="status">Loading checkout…</p>}>
        <OgabasseyCheckoutPage />
      </Suspense>
    </CheckoutThemeProvider>
  );
}
