import { notFound } from 'next/navigation';
import { z } from 'zod';
import { CheckoutThemeProvider } from '@/components/checkout-theme-provider';
import { OxygenOrderConfirmationRedirect } from '@/components/payments/oxygen/OxygenOrderConfirmationRedirect';
import { OxygenStorefrontCheckout } from '@/components/payments/oxygen/OxygenStorefrontCheckout';
import { NewTemplateCheckoutPage } from '@/components/storefront/new-template';
import { CheckoutCartCapacityGate } from '@/components/storefront/ogabassey/pages/checkout/components/CheckoutCartCapacityGate';
import { CheckoutPage as OgabasseyCheckoutPage } from '@/components/storefront/ogabassey/pages/checkout-page';
import {
  getCachedMerchant,
  getCachedMerchantByDomain,
} from '@/lib/cached-data';
import { isDomainIdentifier } from '@/lib/validation';

export async function CheckoutContent({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams?: Promise<{ oxygenOrderId?: string }>;
}) {
  const { slug } = await params;

  const merchant = isDomainIdentifier(slug)
    ? await getCachedMerchantByDomain(slug)
    : await getCachedMerchant(slug);

  if (!merchant) {
    notFound();
  }

  const query = await searchParams;
  const oxygenOrderId = query?.oxygenOrderId;
  if (oxygenOrderId && !z.uuid().safeParse(oxygenOrderId).success) notFound();

  // Check for new template
  if (merchant.template_id === 'new-template') {
    return (
      <CheckoutThemeProvider>
        <CheckoutCartCapacityGate
          cartHref={isDomainIdentifier(slug) ? '/cart' : `/${slug}/cart`}
        >
          <NewTemplateCheckoutPage />
        </CheckoutCartCapacityGate>
      </CheckoutThemeProvider>
    );
  }

  // Ogabassey Template (or any template that doesn't have a custom checkout)
  // Default to ogabassey checkout as it's the fully functional implementation
  return (
    <CheckoutThemeProvider>
      {oxygenOrderId ? (
        <OxygenOrderConfirmationRedirect
          orderId={oxygenOrderId}
          merchantId={merchant.id}
          merchantSlug={merchant.slug}
        >
          <OxygenStorefrontCheckout
            orderId={oxygenOrderId}
            merchantId={merchant.id}
            merchantSlug={merchant.slug}
          />
        </OxygenOrderConfirmationRedirect>
      ) : (
        <OgabasseyCheckoutPage />
      )}
    </CheckoutThemeProvider>
  );
}
