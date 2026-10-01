import { CheckoutThemeProvider } from '@/components/checkout-theme-provider';
import { StorefrontMerchantProvider } from '@/hooks/merchant/storefront-merchant-provider';
import { merchant } from '../../../fixtures';
import { DvaModalFixture } from './DvaModalFixture';
import '@/app/(storefront)/storefront-core.css';
import '@/app/(storefront)/storefront-full.css';

const dvaFixtureMerchant = {
  ...merchant,
  brand_colors: {
    primary: '#6941c6',
    background: '#ffffff',
    accent: '#db2777',
  },
};

export default function DvaModalPage() {
  return (
    <StorefrontMerchantProvider
      initialMerchant={dvaFixtureMerchant}
      initialRoutingMode="domain"
    >
      <CheckoutThemeProvider>
        <DvaModalFixture />
      </CheckoutThemeProvider>
    </StorefrontMerchantProvider>
  );
}
