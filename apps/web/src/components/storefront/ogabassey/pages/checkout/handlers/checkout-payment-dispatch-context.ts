import type { CheckoutOrderItem } from '@/lib/checkout/build-order-items';
import type { JuicywayPendingOrder } from '../hooks/use-juicyway-payment';
import type { useWalletFundedBankTransfer } from '../hooks/use-wallet-funded-bank-transfer';
import type { CryptoPaymentData, PaymentMethod } from '../types';
import type { InitializeCheckoutDvaOptions } from './initialize-checkout-dva';
import type { RedvaultStatus } from './redvault-prepared-order-submit';
import type { CheckoutPaymentOrder } from './submit-checkout-order';

/** Screen-owned data and effects needed after order preparation has completed. */
export interface CheckoutPaymentDispatchContext {
  merchant: { id: string; slug?: string | null };
  order: CheckoutPaymentOrder;
  paymentMethod: PaymentMethod;
  total: number;
  paymentAmount: number;
  createdOrderNumber: string;
  orderChargeCurrency: string;
  currencyCode: string;
  firstName: string;
  lastName: string;
  customerEmail: string;
  customerPhone: string;
  billingAddress: JuicywayPendingOrder['billingAddress'];
  checkoutFingerprint: string;
  checkoutCart: readonly { name: string }[];
  cart: readonly { name: string }[];
  orderItems: CheckoutOrderItem[];
  walletFundedTransfer: Pick<
    ReturnType<typeof useWalletFundedBankTransfer>,
    'start'
  >;
  waitForResolvedStorefrontCustomerAuth: () => Promise<boolean>;
  setIsProcessing: (value: boolean) => void;
  isOrderInFlightRef: { current: boolean };
  setDvaData: InitializeCheckoutDvaOptions['setDvaData'];
  setDvaCountdown: (seconds: number) => void;
  setIsInitializingDva: (value: boolean) => void;
  setRedvaultStatus: (status: RedvaultStatus) => void;
  setPendingCryptoOrder: (order: JuicywayPendingOrder) => void;
  setShowCryptoSelector: (visible: boolean) => void;
  setCryptoPaymentData: (data: CryptoPaymentData) => void;
  capturePaymentStarted: (reference?: string) => void;
  hasPaymentStarted: () => boolean;
  setInitializedReference: (reference: string | undefined) => void;
  clearPendingCheckoutOrder: () => void;
  clearCheckoutSession: () => void;
  clearCart: () => void;
  navigate: (path: string) => void;
  redirect: (url: string) => void;
  completeSignup: () => Promise<void>;
  payForMeDetails: { name: string };
}
