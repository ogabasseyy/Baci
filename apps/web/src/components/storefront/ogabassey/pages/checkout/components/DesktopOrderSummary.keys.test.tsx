import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DesktopOrderSummary } from './DesktopOrderSummary';

describe('DesktopOrderSummary item keys', () => {
  it('renders multiple legacy cart items with empty cartItemId and shared product id without duplicate-key errors', () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    try {
      const legacyCartBase = {
        kind: 'cart' as const,
        id: 'shared-product-id',
        cartItemId: '',
        name: 'iPhone 17 Pro Max',
        status: 'active' as const,
        description: '',
        price: 2343000,
        manage_stock: false,
        stock: 10,
        image: '',
        imageLarge: '',
        imageHint: '',
        brand: '',
        gtin: '',
        mpn: '',
      };
      const { container } = render(
        <DesktopOrderSummary
          displayItems={[
            { ...legacyCartBase, variantId: 'var-256', quantity: 1 },
            { ...legacyCartBase, variantId: 'var-512', quantity: 2 },
          ]}
          formatCurrencyAuto={(amount) => `₦${amount}`}
          summarySubtotal={7029000}
          orderTotals={{ total: 7029000, taxAmount: 0 }}
          taxLabel="Tax"
          deliveryCost={0}
          discountAmount={0}
          deliveryMethod="pickup"
          selectedQuoteId=""
          giftWrappingCost={0}
          paymentMethod="paystack"
          walletCurrencySupported
          walletRedemptionAllowed={false}
          walletLoading={false}
          walletBalance={0}
          hasUser
          currencySymbol="₦"
          payWithWallet={false}
          setPayWithWallet={vi.fn()}
          walletAmountUsed={0}
          remainingAmount={7029000}
          checkoutPayWithWallet={false}
          redvaultSummary={null}
          redvaultOrderReady={false}
          newsletterOptIn={false}
          setNewsletterOptIn={vi.fn()}
          handlePlaceOrder={vi.fn()}
          isProcessing={false}
          isPayForMeValid
          isDeliveryValid
        />
      );
      expect(
        container.querySelector('[data-baci-checkout-variant="var-256"]')
      ).not.toBeNull();
      expect(
        container.querySelector('[data-baci-checkout-variant="var-512"]')
      ).not.toBeNull();
      expect(consoleError).not.toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
    }
  });
});
