import { notFound } from 'next/navigation';
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
import { loadPublishedExperience } from '@/lib/experience/published-manifest';
import { selectTrustedExperienceCheckout } from '@/lib/experience/route-data-revision';
import { isDomainIdentifier } from '@/lib/validation';
import { oxygenCheckoutOrderSchema } from '@/schemas/oxygen-checkout-order';

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
  if (
    oxygenOrderId &&
    !oxygenCheckoutOrderSchema.shape.id.safeParse(oxygenOrderId).success
  )
    notFound();

  // Resume the existing order before choosing a fresh-checkout template.
  if (oxygenOrderId) {
    return (
      <CheckoutThemeProvider>
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
      </CheckoutThemeProvider>
    );
  }

  let experience: Awaited<ReturnType<typeof loadPublishedExperience>> = null;
  try {
    experience = await loadPublishedExperience(merchant);
  } catch {
    /* Native checkout remains available. */
  }
  if (selectTrustedExperienceCheckout(merchant, experience) === 'legacy-demo') {
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
      <OgabasseyCheckoutPage />
    </CheckoutThemeProvider>
  );
}
