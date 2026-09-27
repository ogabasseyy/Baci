import { Suspense } from 'react';
import { CheckoutThemeProvider } from '@/components/checkout-theme-provider';
import { CheckoutPage } from '@/components/storefront/ogabassey/pages/checkout-page';
import '@/app/(storefront)/storefront-core.css';
import '@/app/(storefront)/storefront-full.css';
import { ManualQaControls } from './ManualQaControls';

export default function Page() {
  return (
    <Suspense>
      <CheckoutThemeProvider>
        <ManualQaControls />
        <CheckoutPage />
      </CheckoutThemeProvider>
    </Suspense>
  );
}
