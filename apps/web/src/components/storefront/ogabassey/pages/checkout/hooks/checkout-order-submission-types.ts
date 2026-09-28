import type { CartItem } from '@/hooks/cart';
import type { useCart } from '@/hooks/cart';
import type { useAuthSafe } from '@/contexts/auth-context';
import type { MerchantData } from '@/hooks/merchant/types';
import type { useWalletFundedBankTransfer } from './use-wallet-funded-bank-transfer';
import type { JuicywayPendingOrder, useJuicywayPayment } from './use-juicyway-payment';
import type { useCheckoutDeliverySession } from './use-checkout-delivery-session';
import type { useCheckoutFormState } from './use-checkout-form-state';
import type { useCheckoutPaymentSession } from './use-checkout-payment-session';
import type { useCheckoutSubmissionState } from './use-checkout-submission-state';
import type { useCheckoutStepState } from './use-checkout-step-state';
import type { useStorefrontCustomerSession } from './use-storefront-customer-session';
import type { DvaModalData } from './use-dva-confirm-transfer';
import type { PendingCheckoutOrderSnapshot } from '../pending-checkout-order';
import type { ResumedOrder } from '../types';

type Form = ReturnType<typeof useCheckoutFormState>['values'];
type DeliverySession = ReturnType<typeof useCheckoutDeliverySession>;
type PaymentSession = ReturnType<typeof useCheckoutPaymentSession>;
type StepActions = Pick<
  ReturnType<typeof useCheckoutStepState>,
  'setCurrentStep' | 'setCompletedSteps'
>;
type AuthUser = NonNullable<ReturnType<typeof useAuthSafe>>['user'];

export interface CheckoutOrderSubmissionContext {
  account: {
    createAccount: boolean;
    password: string;
    user: AuthUser | null | undefined;
    waitForResolvedCustomerAuth: ReturnType<typeof useStorefrontCustomerSession>['waitForResolvedAuthenticated'];
  };
  cart: {
    cart: CartItem[];
    checkoutCart: CartItem[];
    checkoutCartTotal: number;
    clearCart: () => void;
    removeFromCart: ReturnType<typeof useCart>['removeFromCart'];
  };
  contact: Pick<Form, 'customerEmail' | 'customerPhone' | 'firstName' | 'lastName' | 'newsletterOptIn'>;
  delivery: {
    session: DeliverySession;
    method: Form['deliveryMethod'];
    airportType: Form['airportType'];
    airportRequiresQuote: Form['airportRequiresQuote'];
    newAddressStreet: Form['newAddressStreet'];
    newAddressCity: Form['newAddressCity'];
    newAddressState: Form['newAddressState'];
    merchantCountry: string;
    giftWrappingCost: number;
    effectiveItemSubtotal: number;
    taxAmount: number;
  };
  merchant: MerchantData | null | undefined;
  navigation: StepActions & {
    pushSuccessRoute: (path: string) => void;
    getHref: (path: string) => string;
  };
  order: {
    pending: PendingCheckoutOrderSnapshot | null;
    clearPending: () => void;
    setPending: (value: PendingCheckoutOrderSnapshot | null) => void;
    setOrderCreated: (value: boolean) => void;
    clearCheckoutSession: () => void;
    setDvaData: (value: DvaModalData | null) => void;
    setDvaCountdown: (value: number) => void;
    setIsInitializingDva: (value: boolean) => void;
    setPendingCryptoOrder: (value: JuicywayPendingOrder | null) => void;
    setShowCryptoSelector: (value: boolean) => void;
    setCryptoPaymentData: ReturnType<typeof useJuicywayPayment>['setCryptoPaymentData'];
    walletFundedTransfer: ReturnType<typeof useWalletFundedBankTransfer>;
  };
  payment: {
    session: PaymentSession;
    bankTransferAvailable: boolean;
    paystackAvailable: boolean;
    korapayAvailable: boolean;
    redvaultAvailable: boolean;
    currencyCode: string;
  };
  resumed: {
    order: ResumedOrder | null;
    preferredGateway: 'credpal' | 'credit_direct' | null;
    trackingToken: string | null;
    merchantSlugFromResume: string | null;
  };
  processing: {
    setIsProcessing: (value: boolean) => void;
    isOrderInFlightRef: { current: boolean };
    tryBeginSubmission: (blocked: boolean) => boolean;
    releaseSubmission: () => void;
    handleSubmissionError: ReturnType<typeof useCheckoutSubmissionState>['handleSubmissionError'];
  };
}
