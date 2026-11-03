import { notFound } from 'next/navigation';
import { CheckoutThemeProvider } from '@/components/checkout-theme-provider';
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

export async function ResolvedCheckoutPage({
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

  const experience = await loadPublishedExperience(merchant);
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
