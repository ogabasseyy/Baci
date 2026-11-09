import type {
  DeliveryMethod,
  SavedAddress,
  ShippingQuote,
  PaymentMethod,
  CryptoPaymentData,
  PendingCryptoOrder,
  ResumedOrder,
} from '../types';

export interface CheckoutCartItem {
  id: string | number;
  name: string;
  quantity: number;
  price: number;
  negotiatedPrice?: number;
  hasAssurance?: boolean;
  assuranceRate?: number;
  variantId?: string;
  variantAttributes?: Record<string, string>;
  selectedColor?: string;
  selectedStorage?: string;
  quizAwardId?: string;
  quizVoucherToken?: string;
}

export interface PlaceOrderOptions {
  merchant: { id: string; slug: string } | null | undefined;
  /**
   * Merchant-resolved order currency code (e.g. 'NGN', 'KES'). Sent to
   * /api/payments/initialize instead of a hardcoded 'NGN'; the server derives
   * the authoritative charge currency from the order and rejects a mismatch.
   */
  currency: string;
  customerEmail: string;
  firstName: string;
  lastName: string;
  customerPhone: string;
  deliveryMethod: DeliveryMethod;
  isNewAddressMode: boolean;
  newAddressStreet: string;
  newAddressCity: string;
  newAddressState: string;
  selectedAddressId: number;
  addresses: SavedAddress[];
  airportType: 'delivery' | 'pickup';
  cart: CheckoutCartItem[];
  cartTotal: number;
  deliveryCost: number;
  total: number;
  // B3.5 (Δ-31, Δ-34, Δ-39): VAT + gift-wrapping carried through to
  // the API so the RPC's VAT enforcement boundary (Δ-42) has the
  // figures the user was shown, and the API's parity check (Δ-39)
  // can compare client expected_total vs server-recomputed total.
  taxAmount: number;
  giftWrappingCost: number;
  selectedQuoteId: string;
  shippingQuotes: ShippingQuote[];
  paymentMethod: PaymentMethod;
  payWithWallet: boolean;
  walletAmountUsed: number;
  createAccount: boolean;
  accountPassword: string;
  newsletterOptIn: boolean;
  user: { id: string } | null | undefined;
  payForMeDetails: { name: string; contact: string; note: string };
  resumedOrder: ResumedOrder | null;
  preferredGateway: 'credpal' | 'credit_direct' | null;
  isOrderInFlightRef: { current: boolean };
  setIsProcessing: (v: boolean) => void;
  setWalletBalance: (v: number) => void;
  setCurrentStep: (v: 'contact' | 'delivery' | 'payment') => void;
  setCompletedSteps: (v: { contact: boolean; delivery: boolean }) => void;
  clearCheckoutSession: () => void;
  clearCart: () => void;
  /**
   * FIX E: remove quiz-prize voucher line(s) from the cart. Invoked when the
   * orders RPC rejects the voucher (expired/already-used/not-approved) so the
   * offending line does not re-fail every subsequent checkout attempt.
   */
  pruneVoucherLines?: (rejectedVoucherToken?: string) => void;
  routerPush: (url: string) => void;
  getHref: (path: string) => string;
  executeDirectPayment: () => Promise<void>;
  crypto: {
    setPendingCryptoOrder: (order: PendingCryptoOrder) => void;
    setShowCryptoSelector: (show: boolean) => void;
    setCryptoPaymentData: (data: CryptoPaymentData) => void;
  };
  dva: {
    handleBankTransfer: (
      order: { id: string },
      paymentAmount: number,
      isOrderInFlightRef: { current: boolean },
      setIsProcessing: (v: boolean) => void
    ) => Promise<void>;
  };
}

export interface LegacyPlacedOrder {
  id: string;
  tracking_token?: string;
}
export interface LegacyOrderData {
  order: LegacyPlacedOrder;
  wallet?: { amountUsed?: number; newBalance: number } | null;
  amountDueToGateway?: number | null;
}
