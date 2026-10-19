import { Suspense } from 'react';
import { CheckoutThemeProvider } from '@/components/checkout-theme-provider';
import { CheckoutPage } from '@/components/storefront/ogabassey/pages/checkout-page';
import { StorefrontCartProvider } from '@/hooks/cart/storefront-cart-provider';
import '@/app/(storefront)/storefront-core.css';
import '@/app/(storefront)/storefront-full.css';
import { merchant } from '../../../fixtures';

// Harness-only: the shared-cart checkout mounts the real checkout page
// under a delegated cart provider. Fixture-only; never deployed.
export default function Page() {
  return (
    <Suspense>
      <CheckoutThemeProvider>
        <StorefrontCartProvider
          merchantId={merchant.id}
          merchantSlug={merchant.slug}
          sharedCartEnabled
        >
          <CheckoutPage />
        </StorefrontCartProvider>
      </CheckoutThemeProvider>
    </Suspense>
  );
}
