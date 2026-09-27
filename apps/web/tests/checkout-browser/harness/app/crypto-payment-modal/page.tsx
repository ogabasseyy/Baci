import { CheckoutThemeProvider } from '@/components/checkout-theme-provider';
import { StorefrontMerchantProvider } from '@/hooks/merchant/storefront-merchant-provider';
import { merchant } from '../../../fixtures';
import { CryptoPaymentModalFixture } from './CryptoPaymentModalFixture';
import '@/app/(storefront)/storefront-core.css';
import '@/app/(storefront)/storefront-full.css';

const cryptoFixtureMerchant = {
  ...merchant,
  brand_colors: {
    primary: '#6941c6',
    background: '#ffffff',
    accent: '#db2777',
  },
};

export default function CryptoPaymentModalPage() {
  return (
    <StorefrontMerchantProvider
      initialMerchant={cryptoFixtureMerchant}
      initialRoutingMode="domain"
    >
      <CheckoutThemeProvider>
        <CryptoPaymentModalFixture />
      </CheckoutThemeProvider>
    </StorefrontMerchantProvider>
  );
}
