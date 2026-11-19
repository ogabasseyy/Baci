import { vi } from 'vitest';
import type { DiscountResult } from '@/components/storefront/checkout/discount-code-input';
import type { CheckoutScreenProps } from './CheckoutScreen';

export const onConfirmTransfer = vi.fn();
export const onCloseTransfer = vi.fn();
export const onAuthSuccess = vi.fn();
export const onDiscountApplied = vi.fn();
export const onSignIn = vi.fn();
const appliedDiscount: DiscountResult = {
  valid: true,
  code: 'WELCOME',
  discount_type: 'percentage',
  discount_value: 10,
};

export function createProps({
  showMobile = true,
  discountVisible = true,
  authOpen = false,
}: {
  showMobile?: boolean;
  discountVisible?: boolean;
  authOpen?: boolean;
} = {}): CheckoutScreenProps {
  return {
    page: {
      onReturnToCart: vi.fn(),
      merchantName: 'Ada Store',
      formatCurrency: (amount) => `₦${amount}`,
    },
    auth: { isOpen: authOpen, onOpenChange: vi.fn(), onSuccess: onAuthSuccess },
    overlays: {
      crypto: {} as CheckoutScreenProps['overlays']['crypto'],
      walletFundedTransfer: {
        error: 'Could not verify transfer',
      } as CheckoutScreenProps['overlays']['walletFundedTransfer'],
      dva: {
        data: {
          account_number: '1234567890',
        } as CheckoutScreenProps['overlays']['dva']['data'],
        isVerifying: false,
        onClose: onCloseTransfer,
        onConfirmTransfer,
      },
    },
    summary: {
      presentation: {
        showMobile,
        mobile: {
          remainingAmount: 9000,
        } as CheckoutScreenProps['summary']['presentation']['mobile'],
        desktop: {
          summarySubtotal: 10000,
        } as CheckoutScreenProps['summary']['presentation']['desktop'],
        discount: {
          visible: discountVisible,
          merchantId: 'merchant-1',
          cartTotal: 10000,
          currencyCountryCode: 'NG',
          payoutCurrency: 'NGN',
          productIds: ['product-1'],
        },
      },
      payment: {
        discount: { applied: appliedDiscount, setApplied: onDiscountApplied },
      } as unknown as CheckoutScreenProps['summary']['payment'],
    },
    steps: { onSignIn } as unknown as CheckoutScreenProps['steps'],
  };
}
