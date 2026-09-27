import { Suspense } from 'react';
import { CheckoutThemeProvider } from '@/components/checkout-theme-provider';
import { CheckoutPage } from '@/components/storefront/ogabassey/pages/checkout-page';
import '@/app/(storefront)/storefront-core.css';
import '@/app/(storefront)/storefront-full.css';

export default function Page() {
  return (
    <Suspense>
      <CheckoutThemeProvider>
        <CheckoutPage />
      </CheckoutThemeProvider>
    </Suspense>
  );
}
