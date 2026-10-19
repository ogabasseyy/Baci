import type { RefObject } from 'react';
import type {
  PaymentMethodType,
  PaymentTab,
} from '@/components/checkout/PaymentMethodSelector';
import type {
  DeliveryMethod,
  ShippingQuote,
} from '@/components/checkout/types';
import type { MobileCheckoutIdempotencyState } from '@/lib/checkout-order-idempotency';
import type {
  SavingsSelection,
  WalletSelection,
} from '@/lib/wallet-payment-helpers';
import type { CartItem } from '@/stores/cart-store';
import type { submitBnplCheckout } from './checkout-bnpl-submit';
import type { PendingCryptoOrder } from './checkout-screen.constants';

interface CheckoutCustomer {
  email?: string | null;
  id?: string;
}

interface CheckoutUser {
  id?: string | null;
}

export interface UseCheckoutSubmitParams {
  onRedvaultOrder?: (
    input: import('./redvault/RedvaultOrderReview').RedvaultReviewInput
  ) => void;
  accountPassword: string;
  appliedDiscountCode?: string | null;
  availablePaymentMethods: PaymentMethodType[];
  clearCart: () => void | Promise<void>;
  currentShippingQuoteContextKey: string;
  customer: CheckoutCustomer | null | undefined;
  deliveryFee: number;
  deliveryMethod: DeliveryMethod;
  getLiveSavingsSelection: (input: {
    isStoreCreditCompatible: boolean;
    items: CartItem[];
    orderTotal: number;
  }) => SavingsSelection | undefined;
  getShippingProvider: () => string | undefined;
  isAuthenticated: boolean;
  isLoadingQuotes: boolean;
  isOrderInFlight: RefObject<boolean>;
  isProcessing: boolean;
  mobileCheckoutIdempotencyRef: RefObject<MobileCheckoutIdempotencyState | null>;
  orderTotals: { taxAmount: number } | null;
  paymentSettings: Parameters<typeof submitBnplCheckout>[0]['paymentSettings'];
  paymentTab: PaymentTab | null;
  resolvedShippingQuoteContextKey: string;
  requiresShippingQuote: boolean;
  saveAsDefaultAddress: boolean;
  saveDetails: boolean;
  selectedPayment: PaymentMethodType | null;
  selectedQuote: ShippingQuote | undefined;
  selectedSavedAddressId: string | null;
  setIsProcessing: (value: boolean) => void;
  setPendingOrder: (value: PendingCryptoOrder | null) => void;
  setShowCryptoSelection: (value: boolean) => void;
  setStep: (step: 'address' | 'payment' | 'review') => void;
  user: CheckoutUser | null | undefined;
  walletBalance: number;
  walletFundedBankTransferOptionEnabled: boolean;
  walletSelection: WalletSelection | undefined;
}
