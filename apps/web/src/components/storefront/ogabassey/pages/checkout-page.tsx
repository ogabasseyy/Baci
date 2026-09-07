'use client';

import { CryptoSelectorModal } from './checkout/components/CryptoSelectorModal';
import {
  isAirportDeliveryEligible,
  isPickupEligible,
} from '@baci/shared';
import {
  AlertCircle,
  Building2,
  ChevronRight,
  CreditCard,
  Loader2,
  Plane,
  ShieldCheck,
  ShoppingBag,
  Truck,
  Check,
  Copy,
  Clock,
  User,
  X,
  Eye,
  EyeOff,
} from 'lucide-react';
import { SmartQuoteLoader } from '../components/SmartQuoteLoader';
import { DoorDeliveryQuoteOptions } from './checkout/components/DoorDeliveryQuoteOptions';
import { isCheckoutDeliveryAddressReady } from './checkout/is-checkout-delivery-address-ready';
import {
  DiscountCodeInput,
  type DiscountResult,
} from '@/components/storefront/checkout/discount-code-input';
import { MobileOrderSummary } from '../components/MobileCheckoutComponents';
import { useRouter, useSearchParams } from 'next/navigation';
import type React from 'react';
import { resolveMerchantDeliveryMethod } from './checkout/resolve-merchant-delivery-method';
import { buildCheckoutBillingAddress } from './checkout/build-checkout-billing-address';
import { useCryptoPaymentInitializer } from './checkout/use-crypto-payment-initializer';
import { useCheckoutFormState } from './checkout/hooks/use-checkout-form-state';
import { persistPendingCheckoutOrder } from './checkout/persist-pending-checkout-order';
import { usePaymentReturnReset } from './checkout/use-payment-return-reset';
import { useEffect, useState, useRef } from 'react';
import { useCart } from '@/hooks/cart';
import type { CartItem } from '@/hooks/cart';
import { useMerchantSafe } from '@/hooks/use-merchant-client';
import { useCurrency } from '@/hooks/use-currency';
import type {
  CryptoChain,
  CryptoCurrency,
  DeliveryMethod,
  CryptoPaymentData,
  DvaData,
  PaymentMethod,
  PendingCryptoOrder,
  ResumedOrder,
} from './checkout/types';
import {
  usePersistedState,
} from '@/hooks/use-persisted-state';
import { useAuthSafe } from '@/contexts/auth-context';
import { PhoneInput } from '@/components/ui/phone-input';
import { CheckoutAuthModal } from '@/components/storefront/checkout-auth-modal';
import { CdnFormatImage } from '@/components/storefront/cdn-format-image';
import {
  AddressAutocomplete,
  type PlaceDetails,
} from '@/components/address-autocomplete';
import { getCredPalKey, openCredPalCheckout } from '@/lib/credpal';
import { openCreditDirectCheckout } from '@/lib/credit-direct-client';
import { asRoute } from '@/lib/routes';
import { AUTO_FRACTION_OPTIONS } from '@/lib/currency';
import { getCountryByCode } from '@/lib/countries';
import { formatAmountInCurrency } from '@/lib/resolve-merchant-currency';
import type { ShippingQuote } from '@/types/shipping-quote';
import { getSubdivisions } from '@/lib/shipping/merchant-rates/subdivisions';
import { toast } from '@/hooks/use-toast';
import { createClient } from '@/lib/supabase/client';
import { calculateCommerce } from '@/lib/supabase/client';
import { buildCheckoutOrderItems } from '@/lib/checkout/build-order-items';
import { toCreditDirectItems } from '@/lib/checkout/credit-direct-items';
import { hasStorefrontPriceNegotiation } from '@/lib/storefront-price-negotiation';
import {
  calculateCartCatalogSubtotal,
  calculateCartItemSubtotal,
  calculateCartTotal,
  getCartItemCheckoutUnitPrice,
  isQuizVoucherCartItem,
  sanitizeCartItems,
} from '@/lib/checkout/cart-entitlement-sanitizer';
import {
  isBankTransferCheckoutAvailable,
  isKorapayCheckoutAvailable,
  isPaystackCheckoutAvailable,
} from '@/lib/checkout/payment-gateway-availability';
import { isNgnChargeCurrency } from './checkout/components/payment-step-availability';
import { isValidPhoneNumber } from 'react-phone-number-input';
import {
  buildPendingCheckoutFingerprint,
  CHECKOUT_PENDING_ORDER_STORAGE_KEY,
  normalizeOrderPaymentMethod,
  resolvePendingCheckoutOrder,
  type PendingCheckoutOrderSnapshot,
} from './checkout/pending-checkout-order';
import {
  clearCheckoutIdempotencyKey,
  getCheckoutIdempotencyKey,
} from './checkout/checkout-idempotency';
import { captureCreditDirectClientCompletion } from './checkout/credit-direct-client-completion';
import {
  type CreditDirectPopupMarker,
  writeCreditDirectPopupMarker,
} from './checkout/credit-direct-popup-return';
import { persistCreditDirectPopupReference } from './checkout/persist-credit-direct-popup-reference';
import { getCheckoutOrderErrorMessage } from './checkout/checkout-order-error-message';
import { selectRejectedVoucherLines } from './checkout/select-rejected-voucher-lines';
import { PaymentStep } from './checkout/components/PaymentStep';
import { AirportDeliveryOptions } from './checkout/components/AirportDeliveryOptions';
import {
  invalidatePendingQuoteRequests,
  loadCheckoutShippingQuotes,
} from './checkout/hooks/checkout-shipping-quote-loader';
import {
  calculateDeliveryCost,
  KLUMP_WALLET_CREDIT_UNAVAILABLE_TOAST,
  createSelectDeliveryMethod,
  getAirDeliveryQuotes,
  getDoorDeliveryQuotes,
  getForwardableSelectedQuoteId,
  getMerchantRateId,
  getPickupStationCopy,
  getStationPickupAddressText,
  getStationPickupQuote,
  getStationPickupQuotes,
  inferAddressLocationFromInput,
  isGiglGoFasterQuote,
  isMerchantQuote,
  isStationPickupQuote,
  isKlumpUnavailableForGatewayAmount,
  resetDeliveryQuotesForAddressChange,
} from './checkout/utils';
import { resolveAirportShippingAddress } from './checkout/resolve-airport-shipping-address';
import { isWalletOrderAutoDebitWebEnabled } from '@/config/wallet-order-auto-debit';
import { isEligibleForWalletFundedBankTransfer } from './checkout/wallet-funded-transfer-eligibility';
import { useWalletFundedBankTransfer } from './checkout/hooks/use-wallet-funded-bank-transfer';
import { useStorefrontCustomerSession } from './checkout/hooks/use-storefront-customer-session';
import { WalletFundedTransferModal } from './checkout/components/WalletFundedTransferModal';
import { WalletTransferConsentDialog } from './checkout/components/WalletTransferConsentDialog';

/**
 * Discriminated union for checkout item rendering. The `kind` tag is set at
 * construction time when we unify the cart and resumed-order item arrays into
 * a single `displayItems` list, so consumers narrow with `item.kind === 'cart'`
 * instead of the fragile `'cartItemId' in item` shape check.
 */
type CheckoutItem =
  | ({ kind: 'cart' } & CartItem)
  | ({ kind: 'resumed' } & ResumedOrder['items'][number]);

interface SavedAddress {
  id: number;
  label: string;
  address: string;
  phone: string;
  isDefault: boolean;
}

interface ShippingLocation {
  city: string;
  state: string;
}

interface InferredCheckoutAddressLocation {
  city: string;
  state: string;
}

const MANUAL_ADDRESS_LOCATION_DEBOUNCE_MS = 500;

interface CreditDirectVerificationHandoff {
  orderId: string;
  merchantSlug: string;
  completionMarker?: CreditDirectPopupMarker | null;
  trackingToken?: string | null;
  customerEmail?: string | null;
}

function buildCreditDirectVerificationPath({
  orderId,
  merchantSlug,
  completionMarker,
  trackingToken,
  customerEmail,
}: CreditDirectVerificationHandoff): string {
  const query = new URLSearchParams({
    orderId,
    gateway: 'credit_direct',
    merchant_slug: merchantSlug,
  });
  if (completionMarker) {
    query.set('creditDirectCompletion', completionMarker.transactionId);
  }
  if (trackingToken) query.set('trackingToken', trackingToken);
  if (customerEmail) query.set('email', customerEmail);
  return `/checkout/bnpl?${query.toString()}`;
}

/**
 * Module-scope checkout helpers.
 *
 * React Compiler cannot yet lower `try {} finally {}` blocks or `throw`
 * statements nested inside a `try/catch` within a component body — each one
 * bails the entire component out of automatic memoization. The async
 * fetch/payment flows below are hoisted to module scope (taking state setters
 * as explicit parameters) so `CheckoutPage` stays compilable while runtime
 * behavior is unchanged.
 */

/**
 * Throws at module scope so call sites inside the component's try/catch avoid
 * the compiler's "ThrowStatement inside of try/catch" bailout.
 */
function raiseCheckoutError(message: string): never {
  throw new Error(message);
}

/**
 * /api/orders rejection codes raised by the merchant-shipping-rate money guard.
 * They all mean "the fee the client quoted no longer matches the merchant's
 * rate config for this destination/subtotal" — surface a single re-quote hint.
 */
const SHIPPING_RATE_REJECTION_CODES = new Set([
  'SHIPPING_FEE_MISMATCH',
  'SHIPPING_RATE_INVALID',
  'SHIPPING_RATE_ZONE_MISMATCH',
  'SHIPPING_RATE_CONDITION_UNMET',
]);

interface ResumedOrderFormFields {
  firstName: string;
  lastName: string;
  customerEmail: string;
  customerPhone: string;
  newAddressStreet: string;
  newAddressState: string;
  newAddressCity: string;
  currentStep: 'contact' | 'delivery' | 'payment';
  completedSteps: { contact: boolean; delivery: boolean };
}

interface LoadResumedCheckoutOrderParams {
  resumeOrderId: string;
  resumeMerchantSlug: string;
  resumeTrackingToken: string | null;
  resumeLookupEmail: string | null;
  preferredGateway: 'credpal' | 'credit_direct' | null;
  setIsLoadingResumedOrder: (isLoading: boolean) => void;
  setResumedOrder: (order: ResumedOrder) => void;
  setCheckoutFields: (fields: ResumedOrderFormFields) => void;
  setPaymentTab: (tab: 'full' | 'installments') => void;
  setPaymentMethod: (method: PaymentMethod) => void;
  setResumeOrderError: (error: string | null) => void;
}

async function loadResumedCheckoutOrder({
  resumeOrderId,
  resumeMerchantSlug,
  resumeTrackingToken,
  resumeLookupEmail,
  preferredGateway,
  setIsLoadingResumedOrder,
  setResumedOrder,
  setCheckoutFields,
  setPaymentTab,
  setPaymentMethod,
  setResumeOrderError,
}: LoadResumedCheckoutOrderParams): Promise<void> {
  setIsLoadingResumedOrder(true);
  try {
    const query = new URLSearchParams();
    query.set('merchant_slug', resumeMerchantSlug);
    if (resumeTrackingToken) {
      query.set('token', resumeTrackingToken);
    }
    if (resumeLookupEmail) {
      query.set('email', resumeLookupEmail);
    }

    const res = await fetch(
      query.toString()
        ? `/api/storefront/orders/${resumeOrderId}?${query.toString()}`
        : `/api/storefront/orders/${resumeOrderId}`
    );
    if (res.ok) {
      const orderData = await res.json();
      setResumedOrder({
        id: orderData.id,
        short_id: orderData.short_id,
        subtotal: orderData.subtotal,
        shipping_cost: orderData.shipping_cost ?? 0,
        tax_amount: orderData.tax_amount ?? 0,
        discount_amount: orderData.discount_amount ?? 0,
        total: orderData.total,
        customer_name: orderData.customer_name,
        customer_email: orderData.customer_email,
        customer_phone: orderData.customer_phone,
        tracking_token: orderData.tracking_token,
        shipping_address: orderData.shipping_address || {
          address: '',
          city: '',
          state: '',
          phone: '',
        },
        items: orderData.items || [],
      });

      // Pre-fill form with order data
      const [first, ...rest] = (orderData.customer_name || '').split(' ');
      setCheckoutFields({
        firstName: first || '',
        lastName: rest.join(' ') || '',
        customerEmail: orderData.customer_email || '',
        customerPhone: orderData.customer_phone || '',
        newAddressStreet: orderData.shipping_address?.address || '',
        newAddressState: orderData.shipping_address?.state || '',
        newAddressCity: orderData.shipping_address?.city || '',
        // Skip directly to payment step for resumed orders
        currentStep: 'payment',
        completedSteps: { contact: true, delivery: true },
      });

      // 2025 FIX: Sync paymentTab with preferredGateway to prevent UI crash
      // If a BNPL gateway is selected, we MUST switch to the 'installments' tab
      if (preferredGateway === 'credit_direct' || preferredGateway === 'credpal') {
        setPaymentTab('installments');
        setPaymentMethod(preferredGateway);
      } else if (preferredGateway) {
        setPaymentTab('full');
        setPaymentMethod(preferredGateway);
      }
    } else {
      console.error('Failed to fetch resumed order');
      setResumeOrderError('Order not found. It may have been completed or expired.');
    }
  } catch (error) {
    console.error('Error fetching resumed order:', error);
    setResumeOrderError('Failed to load order details. Please try again.');
  } finally {
    setIsLoadingResumedOrder(false);
  }
}

interface LoadShippingStatesParams {
  /** Merchant country (ISO-2, upper-case) the address form is keyed to. */
  merchantCountry: string;
  /**
   * Aborted by the effect cleanup when `merchantCountry` changes so a stale NG
   * `/api/shipping/locations` response can't clobber a fresher subdivision list.
   */
  signal: AbortSignal;
  setIsLoadingLocations: (isLoading: boolean) => void;
  setShippingStates: (states: string[]) => void;
}

async function loadShippingStates({
  merchantCountry,
  signal,
  setIsLoadingLocations,
  setShippingStates,
}: LoadShippingStatesParams): Promise<void> {
  // Non-NG markets derive their state list from the merchant-country
  // subdivision vocabulary (IN/AE ship real states; unsupported countries
  // yield [] — a graceful, no-worse-than-today fallback). NG keeps the rich
  // /api/shipping/locations dataset AND its state->city sub-fetch untouched.
  if (merchantCountry !== 'NG') {
    setShippingStates(
      getSubdivisions(merchantCountry).map((subdivision) => subdivision.name)
    );
    return;
  }

  setIsLoadingLocations(true);
  try {
    const res = await fetch('/api/shipping/locations', { signal });
    // A newer merchantCountry (e.g. NG→IN once an async merchant resolves)
    // aborts this request via the effect cleanup. Bail before overwriting the
    // fresh non-NG subdivisions with the stale NG payload. Checking
    // `signal.aborted` (not just relying on the fetch to reject) also covers
    // mocked/instant fetches that resolve regardless of the abort.
    if (signal.aborted) {
      return;
    }
    if (res.ok) {
      const data = await res.json();
      if (signal.aborted) {
        return;
      }
      setShippingStates(data.states || []);
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return;
    }
    console.error('Failed to fetch states', error);
  } finally {
    if (!signal.aborted) {
      setIsLoadingLocations(false);
    }
  }
}

interface LoadWalletBalanceParams {
  merchantSlug: string;
  signal: AbortSignal;
  setWalletLoading: (isLoading: boolean) => void;
  setWalletBalance: (balance: number) => void;
  setPayWithWallet: (payWithWallet: boolean) => void;
}

async function loadWalletBalance({
  merchantSlug,
  signal,
  setWalletLoading,
  setWalletBalance,
  setPayWithWallet,
}: LoadWalletBalanceParams): Promise<void> {
  setWalletLoading(true);
  try {
    const response = await fetch(
      `/api/storefront/customer/wallet?merchant=${merchantSlug}`,
      { signal }
    );
    if (response.ok) {
      const data = await response.json();
      const balance = Number(data.balance) || 0;
      setWalletBalance(balance);
      // Auto-apply wallet credit if balance > 0 (Shopify 2025 pattern)
      if (balance > 0) {
        setPayWithWallet(true);
      }
    }
  } catch (error) {
    // Ignore abort errors (component unmounted)
    if (error instanceof Error && error.name !== 'AbortError') {
      console.error('Failed to fetch wallet balance:', error);
    }
  } finally {
    if (!signal.aborted) {
      setWalletLoading(false);
    }
  }
}


interface RequestDvaInitializationParams {
  merchantId: string;
  orderId: string;
  customerEmail: string;
  customerName: string;
  customerPhone: string;
  billingAddress: DvaBillingAddress;
  /** Merchant-resolved fiat order currency (server derives from order). */
  orderCurrency: string;
}

interface DvaBillingAddress {
  line1: string;
  city: string;
  state?: string;
  country: string;
  zip_code?: string;
}

async function requestDvaInitialization({
  merchantId,
  orderId,
  customerEmail,
  customerName,
  customerPhone,
  billingAddress,
  orderCurrency,
}: RequestDvaInitializationParams): Promise<{
  dva: Omit<DvaData, 'amount' | 'reference'>;
  reference: string;
}> {
  const response = await fetch('/api/payments/initialize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      merchant_id: merchantId,
      order_id: orderId,
      currency: orderCurrency,
      customer_email: customerEmail,
      customer_name: customerName,
      customer_phone: customerPhone,
      gateway: 'paystack',
      payment_type: 'dva', // Dedicated Virtual Account
      billing_address: billingAddress,
    }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => null);
    throw new Error(errorData?.error || 'Failed to initialize bank transfer');
  }

  const result = await response.json();
  if (result.success && result.dva) {
    return { dva: result.dva, reference: result.reference };
  }
  throw new Error('DVA not returned by the gateway');
}

export const CheckoutPage: React.FC = () => {
  const { cart, clearCart, isHydrated, removeFromCart } = useCart();
  const merchantContext = useMerchantSafe();
  const merchant = merchantContext?.merchant;

  // Address-form country: the merchant's own market (ISO-2, upper-case), NG as
  // the pilot default when unset. Drives the state list source, the Places
  // country bias, and whether the NG-only state->city sub-fetch runs — so a
  // non-NG merchant's shoppers can populate state/city and reach merchant rates.
  const merchantCountry = (merchant?.country?.trim() || 'NG').toUpperCase();

  // Merchant-resolved currency (payout_currency first, country second, NGN
  // fallback). `currencyCode` is sent to /api/payments/initialize instead of a
  // hardcoded 'NGN'; the compact formatter renders order amounts.
  const { formatCurrencyAuto, currencySymbol, currencyCode } = useCurrency();

  const hasPriceNegotiation = hasStorefrontPriceNegotiation(merchant);

  const checkoutCart = sanitizeCartItems(cart, hasPriceNegotiation);
  const quoteItemsFingerprint = checkoutCart
    .map(
      ({ id, negotiatedPrice, price, quantity }) =>
        `${id}:${quantity}:${negotiatedPrice ?? price}`
    )
    .join('|');

  const checkoutCartTotal = calculateCartTotal(
    checkoutCart,
    hasPriceNegotiation
  );

  // Catalog (pre-negotiation) subtotal sent to the quotes API. The order-time
  // merchant-rate fee guard verifies free-over / price-tier thresholds against
  // the canonical CATALOG subtotal, so quoting with the negotiated
  // `checkoutCartTotal` could select a different tier and fail-closed 400 a
  // legitimate checkout. See `calculateCartCatalogSubtotal`.
  const checkoutCartCatalogSubtotal = calculateCartCatalogSubtotal(
    checkoutCart,
    hasPriceNegotiation
  );

  const itemSubtotal = calculateCartItemSubtotal(
    checkoutCart,
    hasPriceNegotiation
  );

  // Paystack (and its DVA-backed bank transfer) settle NGN only — mirror the
  // PaymentStep gating so a non-NGN checkout never renders rails the
  // initialize API would reject with UNSUPPORTED_CURRENCY.
  const ngnRailsAvailable = isNgnChargeCurrency(currencyCode);
  const paystackCheckoutAvailable =
    ngnRailsAvailable && isPaystackCheckoutAvailable(merchant);
  const korapayCheckoutAvailable = isKorapayCheckoutAvailable(
    merchant,
    currencyCode
  );
  const bankTransferCheckoutAvailable =
    ngnRailsAvailable && isBankTransferCheckoutAvailable(merchant);
  const basePath = merchantContext?.basePath;
  const router = useRouter();

  const getHref = (path: string) =>
    path.startsWith('http') ? path : `${basePath || ''}${path === '/' ? '' : path}`;

  const searchParams = useSearchParams();
  const auth = useAuthSafe();
  const user = auth?.user;

  // Persisted checkout form state - survives hydration re-mounts and page refreshes
  // Using custom hook with debounced sessionStorage persistence (2025 best practice)
  const {
    values: checkoutForm,
    setValue: setCheckoutField,
    setValues: setCheckoutFields,
    clear: clearCheckoutSession,
  } = useCheckoutFormState();

  // Destructure for convenience (these are reactive)
  const {
    firstName,
    lastName,
    customerEmail,
    customerPhone,
    newAddressStreet,
    newAddressState,
    newAddressCity,
    deliveryCoordinates,
    deliveryMethod,
    newsletterOptIn,
    currentStep: rawCurrentStep,
    completedSteps: rawCompletedSteps,
  } = checkoutForm;

  // Hydration safety: Force default state during server/first render to match server HTML
  const currentStep = isHydrated ? rawCurrentStep : 'contact';
  const completedSteps = isHydrated ? rawCompletedSteps : { contact: false, delivery: false };

  // Convenient setters that update the persisted form
  const setFirstName = (v: string) => setCheckoutField('firstName', v);
  const setLastName = (v: string) => setCheckoutField('lastName', v);
  const setCustomerEmail = (v: string) => setCheckoutField('customerEmail', v);
  const setCustomerPhone = (v: string) => setCheckoutField('customerPhone', v);
  const setNewAddressState = (v: string) => setCheckoutField('newAddressState', v);
  const setNewAddressCity = (v: string) => setCheckoutField('newAddressCity', v);
  const setCurrentStep = (v: 'contact' | 'delivery' | 'payment') => setCheckoutField('currentStep', v);
  const setCompletedSteps = (v: { contact: boolean; delivery: boolean } | ((prev: { contact: boolean; delivery: boolean }) => { contact: boolean; delivery: boolean })) => {
    if (typeof v === 'function') {
      setCheckoutField('completedSteps', v(completedSteps));
    } else {
      setCheckoutField('completedSteps', v);
    }
  };
  const inferredLocationDebounceRef = useRef<number | null>(null);
  const clearInferredLocationDebounce = () => {
    if (inferredLocationDebounceRef.current !== null) {
      window.clearTimeout(inferredLocationDebounceRef.current);
      inferredLocationDebounceRef.current = null;
    }
  };
  const scheduleInferredLocationUpdate = ({
    city,
    state,
  }: InferredCheckoutAddressLocation) => {
    clearInferredLocationDebounce();
    inferredLocationDebounceRef.current = window.setTimeout(() => {
      setCheckoutFields({
        newAddressCity: city,
        newAddressState: state,
      });
      inferredLocationDebounceRef.current = null;
    }, MANUAL_ADDRESS_LOCATION_DEBOUNCE_MS);
  };
  const [
    pendingCheckoutOrder,
    setPendingCheckoutOrder,
    clearPendingCheckoutOrder,
  ] = usePersistedState<PendingCheckoutOrderSnapshot | null>(
    CHECKOUT_PENDING_ORDER_STORAGE_KEY,
    null
  );

  // Non-persisted UI state
  const [createAccount, setCreateAccount] = useState(false);
  const [accountPassword, setAccountPassword] = useState('');
  const setNewsletterOptIn = (value: boolean) => setCheckoutField('newsletterOptIn', value);
  const [showPasswordInput, setShowPasswordInput] = useState(false);
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [contactValidationAttempted, setContactValidationAttempted] = useState(false);

  useEffect(() => {
    return () => {
      if (inferredLocationDebounceRef.current !== null) {
        window.clearTimeout(inferredLocationDebounceRef.current);
      }
    };
  }, []);

  // Copy to clipboard helper (2025: Clipboard API with visual feedback)
  const [copiedText, setCopiedText] = useState<string | null>(null);
  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedText(text);
      // Auto-clear after 2 seconds
      setTimeout(() => setCopiedText(null), 2000);
    } catch (err) {
      // Clipboard API not supported - show error instead of using deprecated method
      console.error('Clipboard API not available:', err);
    }
  };

  // Validation States (hydration-safe: default to false during SSR to match disabled="" on server)
  const rawIsContactValid = (() => {
    const hasRequiredFields = firstName.trim() && lastName.trim() && customerEmail.trim() && customerPhone;
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const isPhoneValid = customerPhone && isValidPhoneNumber(customerPhone);
    return !!(hasRequiredFields && emailRegex.test(customerEmail.trim()) && isPhoneValid);
  })();
  const isContactValid = isHydrated ? rawIsContactValid : false;


  // Crypto payment modal state
  const [cryptoPaymentData, setCryptoPaymentData] = useState<{
    address: string;
    chain: string;
    currency: string;
    amount: number;
    confirmation_time: string;
    orderId: string;
    trackingToken?: string;
    reference: string;
    sessionId: string; // Payment session ID (from initialization)
    paymentId: string; // Payment ID (from capture) - used for verification via GET /payments/{id}
    qrcode?: string;
  } | null>(null);

  // Dedicated Virtual Account (DVA) state
  const [dvaData, setDvaData] = useState<{
    account_number: string;
    account_name: string;
    bank_name: string;
    bank_code: string;
    amount: number;
    reference: string;
  } | null>(null);
  const [isInitializingDva, setIsInitializingDva] = useState(false);
  const [dvaCountdown, setDvaCountdown] = useState(3600); // 1 hour in seconds

  // Crypto payment verification state
  const [isVerifyingCrypto, setIsVerifyingCrypto] = useState(false);
  const [cryptoVerificationStatus, setCryptoVerificationStatus] = useState<'idle' | 'checking' | 'confirmed' | 'pending' | 'failed'>('idle');

  // Crypto selection state (before payment is initialized)
  const [showCryptoSelector, setShowCryptoSelector] = useState(false);
  const [selectedCryptoChain, setSelectedCryptoChain] = useState<'TRX' | 'ETH' | 'MATIC' | 'AVAXC'>('TRX');
  const [selectedCryptoCurrency, setSelectedCryptoCurrency] = useState<'USDT' | 'USDC'>('USDT');
  const [pendingCryptoOrder, setPendingCryptoOrder] = useState<{
    orderId: string;
    trackingToken?: string;
    amount: number;
    /** Stamped order currency (authoritative for payment initialization). */
    orderCurrency: string;
    customerEmail: string;
    customerName: string;
    customerPhone: string;
    billingAddress: {
      line1: string;
      city: string;
      state: string;
      country: string;
      zip_code?: string;
    };
    items: Array<{ name: string; type: 'physical' | 'digital' }>;
  } | null>(null);

  // Mobile app order resume state
  // When opening from mobile app with ?orderId=xxx&gateway=credpal, we resume that order
  const resumeOrderId = searchParams.get('orderId');
  const resumeTrackingToken =
    searchParams.get('trackingToken') ||
    searchParams.get('tracking_token') ||
    searchParams.get('token');
  const resumeLookupEmail =
    searchParams.get('email')?.trim() ||
    (pendingCheckoutOrder?.orderId === resumeOrderId &&
    pendingCheckoutOrder.customerEmail &&
    (!merchant?.id || pendingCheckoutOrder.merchantId === merchant.id)
      ? pendingCheckoutOrder.customerEmail.trim()
      : '') ||
    null;
  const resumeMerchantSlug =
    searchParams.get('merchant_slug') ||
    searchParams.get('slug') ||
    merchant?.slug ||
    null;
  const gatewayParam = searchParams.get('gateway')?.toLowerCase();
  const preferredGateway =
    gatewayParam === 'credpal' || gatewayParam === 'credit_direct'
      ? gatewayParam
      : null;
  const [resumedOrder, setResumedOrder] = useState<ResumedOrder | null>(null);
  const [isLoadingResumedOrder, setIsLoadingResumedOrder] = useState(!!resumeOrderId);
  const [resumeOrderError, setResumeOrderError] = useState<string | null>(null);

  // Tag each item at construction time so downstream rendering narrows on
  // `item.kind` (a literal discriminator) rather than `'cartItemId' in item`,
  // which would silently break if either type ever gained an optional
  // `cartItemId` field. Active cart wins when populated; otherwise fall back
  // to the resumed order's items.
  const hasCheckoutCartItems = checkoutCart.length > 0;
  const displayItems: CheckoutItem[] =
    hasCheckoutCartItems
      ? checkoutCart.map((item) => ({ kind: 'cart' as const, ...item }))
      : (resumedOrder?.items ?? []).map((item) => ({ kind: 'resumed' as const, ...item }));
  const resumedOrderCartItems: CartItem[] =
    !hasCheckoutCartItems && resumedOrder
      ? resumedOrder.items.map((item) => ({
          brand: '',
          cartItemId: item.id,
          description: '',
          gtin: '',
          id: item.product_id || item.id,
          image: item.image_url || '',
          imageHint: item.product_name,
          imageLarge: item.image_url || '',
          manage_stock: false,
          mpn: '',
          name: item.product_name,
          price: item.price,
          quantity: item.quantity,
          status: 'active' as const,
          stock: item.quantity,
        }))
      : [];
  const mobileSummaryCart = hasCheckoutCartItems
    ? checkoutCart
    : resumedOrderCartItems;
  const effectiveItemSubtotal = hasCheckoutCartItems
    ? itemSubtotal
    : resumedOrder?.subtotal || 0;
  const effectiveCheckoutCartTotal = hasCheckoutCartItems
    ? checkoutCartTotal
    : resumedOrder?.subtotal || checkoutCartTotal;

  const autoTriggerRef = useRef(false);
  // Double-submit protection: prevents race conditions from rapid clicks
  const isOrderInFlightRef = useRef(false);
  usePaymentReturnReset(() => {
    setIsProcessing(false);
    isOrderInFlightRef.current = false;
  });

  // Storefront customer sign-in state. The `(commerce)` checkout route mounts
  // neither `AuthProvider` nor `CustomerAuthProvider`, so `useAuthSafe()` above
  // is null here even for a signed-in customer. The wallet-funded gate must read
  // the cookie session directly (same source as the storefront header) or the
  // dark-launch flow would never activate for real customers.
  const { waitForResolvedAuthenticated: waitForResolvedStorefrontCustomerAuth } =
    useStorefrontCustomerSession(merchant?.slug ?? undefined);

  // Wallet-funded bank transfer (P4a, dark-launched). Signed-in customers of an
  // auto-debit-enabled merchant fund the order through their STANDING wallet
  // account number; the webhook credits the wallet and the order auto-debits.
  // Everything this declines falls back to the legacy order-DVA path below.
  const walletFundedTransfer = useWalletFundedBankTransfer({
    merchantId: merchant?.id,
    merchantSlug: merchant?.slug ?? undefined,
    onOrderPaid: ({ checkoutFingerprint, orderId, trackingToken }) => {
      clearPendingCheckoutOrder();
      void clearCheckoutIdempotencyKey(checkoutFingerprint);
      clearCheckoutSession();
      const successQuery = new URLSearchParams({ orderId, wallet: 'true' });
      if (trackingToken) {
        successQuery.set('trackingToken', trackingToken);
      }
      router.push(
        asRoute(getHref(`/order-success?${successQuery.toString()}`))
      );
      setTimeout(clearCart, 500);
    },
  });

  // Chain/currency compatibility
  const cryptoChainSupport: Record<'USDT' | 'USDC', Array<'TRX' | 'ETH' | 'MATIC' | 'AVAXC'>> = {
    USDT: ['TRX', 'ETH'],
    USDC: ['ETH', 'MATIC', 'AVAXC'],
  };

  // When currency changes, ensure chain is compatible
  const handleCryptoCurrencyChange = (currency: 'USDT' | 'USDC') => {
    setSelectedCryptoCurrency(currency);
    const supportedChains = cryptoChainSupport[currency];
    if (!supportedChains.includes(selectedCryptoChain)) {
      setSelectedCryptoChain(supportedChains[0]);
    }
  };

  const cryptoInitializer = useCryptoPaymentInitializer({
    onReady: (payment) => {
      setShowCryptoSelector(false);
      setCryptoPaymentData(payment);
    },
    onError: (error) => toast({
      title: 'Crypto Payment Failed',
      description: error instanceof Error ? error.message : 'Failed to initialize crypto payment',
      variant: 'destructive',
    }),
  });
  const initializeCryptoPayment = async () => {
    if (!pendingCryptoOrder || !merchant) return;
    await cryptoInitializer.initialize({
      merchantId: merchant.id,
      pendingOrder: pendingCryptoOrder,
      chain: selectedCryptoChain,
      currency: selectedCryptoCurrency,
      orderCurrency: pendingCryptoOrder.orderCurrency,
    }).catch(() => undefined);
  };

  // Verify crypto payment status by polling the API
  // Uses a ref to track polling state to avoid stale closure issues
  const pollingRef = useRef<{ intervalId: NodeJS.Timeout | null; attempts: number }>({
    intervalId: null,
    attempts: 0,
  });

  const verifyCryptoPayment = async () => {
    // Use paymentId for verification (from the capture response)
    // Fall back to sessionId if paymentId is not available
    const verificationId = cryptoPaymentData?.paymentId || cryptoPaymentData?.sessionId;

    if (!verificationId) {
      console.error('No payment ID or session ID available for verification');
      setCryptoVerificationStatus('failed');
      return;
    }

    setIsVerifyingCrypto(true);
    setCryptoVerificationStatus('checking');
    pollingRef.current.attempts = 0;

    const checkPaymentStatus = async (): Promise<'confirmed' | 'failed' | 'pending'> => {
      try {
        // Use payment_id parameter for GET /payments/{id} endpoint
        const response = await fetch(
          `/api/payments/status?gateway=juicyway&payment_id=${verificationId}`
        );

        if (!response.ok) {
          // Try to parse error, but handle JSON parse failures gracefully
          let errorData = {};
          try {
            errorData = await response.json();
          } catch {
            errorData = { message: `HTTP ${response.status}: ${response.statusText}` };
          }
          console.error('Payment status check failed:', {
            status: response.status,
            statusText: response.statusText,
            paymentId: verificationId,
            error: errorData,
          });
          return 'pending'; // Treat API errors as pending, not failed
        }

        const result = await response.json();

        if (result.is_confirmed) {
          return 'confirmed';
        }

        if (result.is_failed) {
          return 'failed';
        }

        return 'pending';
      } catch (error) {
        console.error('Payment verification error:', error);
        return 'pending';
      }
    };

    // Initial check
    const initialStatus = await checkPaymentStatus();

    if (initialStatus === 'confirmed') {
      setIsVerifyingCrypto(false);
      setCryptoVerificationStatus('confirmed');
      clearPendingCheckoutOrder();
      clearCheckoutSession();
      clearCart();
      const successQuery = new URLSearchParams({
        type: 'crypto',
        orderId: cryptoPaymentData.orderId,
        reference: cryptoPaymentData.reference,
      });
      if (cryptoPaymentData.trackingToken) {
        successQuery.set('trackingToken', cryptoPaymentData.trackingToken);
      }
      router.push(asRoute(getHref(`/order-success?${successQuery.toString()}`)));
      return;
    }

    if (initialStatus === 'failed') {
      setIsVerifyingCrypto(false);
      setCryptoVerificationStatus('failed');
      return;
    }

    // Start polling
    setCryptoVerificationStatus('pending');

    pollingRef.current.intervalId = setInterval(async () => {
      pollingRef.current.attempts++;
      const maxAttempts = 30; // 5 minutes (30 * 10 seconds)

      if (pollingRef.current.attempts >= maxAttempts) {
        if (pollingRef.current.intervalId) {
          clearInterval(pollingRef.current.intervalId);
          pollingRef.current.intervalId = null;
        }
        setIsVerifyingCrypto(false);
        setCryptoVerificationStatus('pending');
        return;
      }

      const status = await checkPaymentStatus();

      if (status === 'confirmed') {
        if (pollingRef.current.intervalId) {
          clearInterval(pollingRef.current.intervalId);
          pollingRef.current.intervalId = null;
        }
        setIsVerifyingCrypto(false);
        setCryptoVerificationStatus('confirmed');
        clearPendingCheckoutOrder();
        clearCheckoutSession();
        clearCart();
        const successQuery = new URLSearchParams({
          type: 'crypto',
          orderId: cryptoPaymentData.orderId,
          reference: cryptoPaymentData.reference,
        });
        if (cryptoPaymentData.trackingToken) {
          successQuery.set('trackingToken', cryptoPaymentData.trackingToken);
        }
        router.push(asRoute(getHref(`/order-success?${successQuery.toString()}`)));
      } else if (status === 'failed') {
        if (pollingRef.current.intervalId) {
          clearInterval(pollingRef.current.intervalId);
          pollingRef.current.intervalId = null;
        }
        setIsVerifyingCrypto(false);
        setCryptoVerificationStatus('failed');
      }
    }, 10000); // Poll every 10 seconds
  };

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollingRef.current.intervalId) {
        clearInterval(pollingRef.current.intervalId);
      }
    };
  }, []);

  // Retrieve gift data if passed from cart
  const giftWrappingCost = Number(searchParams.get('giftWrappingCost')) || 0;

  // Saved Addresses (Future integration: Fetch from API)
  const [addresses, _setAddresses] = useState<SavedAddress[]>([]); // Empty for now, forcing new address


  const [selectedAddressId, setSelectedAddressId] = useState<number>(0);
  const [isNewAddressMode, setIsNewAddressMode] = useState(true);
  const setDeliveryMethod = (value: DeliveryMethod) => setCheckoutField('deliveryMethod', value);
  const [airportType, setAirportType] = useState<'delivery' | 'pickup'>('delivery');

  // Shipping State
  const [shippingStates, setShippingStates] = useState<string[]>([]);
  const [shippingCities, setShippingCities] = useState<string[]>([]);
  const [isLoadingLocations, setIsLoadingLocations] = useState(false);
  const [shippingQuotes, setShippingQuotes] = useState<ShippingQuote[]>([]);
  const [isLoadingQuotes, setIsLoadingQuotes] = useState(false);
  const [selectedQuoteId, setSelectedQuoteId] = useState<string>('');
  const [resolvedQuoteRequestKey, setResolvedQuoteRequestKey] = useState('');
  const quoteRequestSequence = useRef(0);
  const quoteAbortController = useRef<AbortController | null>(null);
  const stationPickupQuote = getStationPickupQuote(shippingQuotes);
  // All pickup options for this zone. A merchant can configure several pickup
  // locations, so when there is more than one we render a selectable list
  // instead of collapsing to the first quote.
  const stationPickupQuotes = getStationPickupQuotes(shippingQuotes);
  // True when the merchant configured at least one PICKUP rate for this zone.
  // `stationPickupQuote` is only the FIRST station-pickup quote, which can be a
  // GIGL station when both a GIGL station and a merchant pickup are returned —
  // so delivery-tab visibility must key off ALL station-pickup quotes, not the
  // first, otherwise the free hardcoded legacy pickup tab would leak through and
  // let a Lagos shopper bypass the merchant's configured pickup fee.
  const hasMerchantPickupQuote = stationPickupQuotes.some(isMerchantQuote);
  const doorDeliveryQuotes = getDoorDeliveryQuotes(shippingQuotes);
  const airDeliveryQuotes = getAirDeliveryQuotes(shippingQuotes);
  const selectedQuote = shippingQuotes.find(
    (quote) => String(quote.id) === String(selectedQuoteId),
  );
  const selectedQuoteMatchesDeliveryMethod = Boolean(
    selectedQuote &&
      ((deliveryMethod === 'door' && !isStationPickupQuote(selectedQuote)) ||
        (deliveryMethod === 'airport' &&
          isGiglGoFasterQuote(selectedQuote)) ||
        (deliveryMethod === 'pickup_station' &&
          isStationPickupQuote(selectedQuote))),
  );
  const selectDeliveryMethod = createSelectDeliveryMethod({
    selectedQuoteId,
    setDeliveryMethod,
    setSelectedQuoteId,
    shippingQuotes,
  });
  const resetQuotesForAddressChange = () => {
    invalidatePendingQuoteRequests(
      quoteRequestSequence,
      quoteAbortController,
    );
    setIsLoadingQuotes(false);
    setResolvedQuoteRequestKey('');
    resetDeliveryQuotesForAddressChange({
      setDeliveryMethod,
      setSelectedQuoteId,
      setShippingQuotes,
      // Drop stale autocomplete coordinates so a later saved-address selection
      // cannot price/route with the previous place's lat/lng.
      clearDeliveryCoordinates: () =>
        setCheckoutFields({ deliveryCoordinates: null }),
    });
  };
  const eligibleDeliveryMethod = resolveMerchantDeliveryMethod(
    deliveryMethod,
    newAddressState,
    merchant?.slug,
  );
  if (eligibleDeliveryMethod !== deliveryMethod) {
    setDeliveryMethod(eligibleDeliveryMethod);
  }

  // R16-2: when the merchant exposes pickup rates for this zone, the legacy
  // hardcoded `pickup` tab is HIDDEN (see the tab list). But a shopper who had
  // already selected legacy `pickup` while the quotes were still loading would
  // otherwise keep `deliveryMethod === 'pickup'` — the card is merely hidden,
  // `rawIsDeliveryValid` still treats pickup as valid, and the order submits
  // `shipping_fee: 0` with no `shipping_rate_id`, bypassing the merchant pickup
  // fee. Force the selection onto the merchant pickup rate so the fee is
  // applied. react.dev "adjust state during render when a derived value
  // changes" pattern (NOT a manual memo). Guarded on legacy `pickup` still
  // being the ELIGIBLE method so it can never override the eligibility redirect
  // above; only fires when a merchant pickup quote exists, leaving NG /
  // non-merchant pickup-less flows untouched.
  const firstMerchantPickupQuoteId = hasMerchantPickupQuote
    ? (stationPickupQuotes.find(isMerchantQuote)?.id ?? '')
    : '';
  if (
    hasMerchantPickupQuote &&
    deliveryMethod === 'pickup' &&
    eligibleDeliveryMethod === 'pickup'
  ) {
    setDeliveryMethod('pickup_station');
    if (firstMerchantPickupQuoteId) {
      setSelectedQuoteId(firstMerchantPickupQuoteId);
    }
  }

  // Delivery step validation (hydration-safe)
  const rawIsDeliveryValid = (() => {
    if (!deliveryMethod) return false;
    if (eligibleDeliveryMethod !== deliveryMethod) return false;
    // For door delivery, a shipping quote MUST be selected
    if (deliveryMethod === 'door') {
      return Boolean(selectedQuoteId && selectedQuoteMatchesDeliveryMethod);
    }
    if (deliveryMethod === 'pickup_station') {
      return Boolean(selectedQuoteId && selectedQuoteMatchesDeliveryMethod);
    }
    // For airport, a type (pickup/delivery) must be selected
    if (deliveryMethod === 'airport') return !!airportType;
    // Pickup is valid as long as the current state is eligible.
    return true;
  })();
  const isDeliveryValid = isHydrated ? rawIsDeliveryValid : false;

  // Note: newAddressState, newAddressCity, newAddressStreet are now part of checkoutForm (persisted)


  // Payment State (declared before the resumed-order effect below, which
  // pre-selects the tab/method for BNPL deep links — React Compiler requires
  // declaration before first access)
  const [paymentTab, setPaymentTab] = useState<'full' | 'installments'>('full');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('');

  // Fetch resumed order from mobile app when orderId is in URL.
  // The async try/catch/finally flow lives in module-scope
  // `loadResumedCheckoutOrder` so the compiler can memoize this component.
  useEffect(() => {
    if (!resumeOrderId || !resumeMerchantSlug) return;

    loadResumedCheckoutOrder({
      resumeOrderId,
      resumeMerchantSlug,
      resumeTrackingToken,
      resumeLookupEmail,
      preferredGateway,
      setIsLoadingResumedOrder,
      setResumedOrder,
      setCheckoutFields,
      setPaymentTab,
      setPaymentMethod,
      setResumeOrderError,
    });
  }, [
    preferredGateway,
    resumeOrderId,
    resumeLookupEmail,
    resumeMerchantSlug,
    resumeTrackingToken,
    setCheckoutFields,
  ]);

  // Load the address state list. NG hits /api/shipping/locations (rich data);
  // non-NG markets derive their states from the subdivision vocabulary. Keyed
  // on merchantCountry so it settles correctly once the merchant resolves.
  // (try/finally hoisted to module scope for the compiler.)
  useEffect(() => {
    const controller = new AbortController();
    loadShippingStates({
      merchantCountry,
      signal: controller.signal,
      setIsLoadingLocations,
      setShippingStates,
    });
    return () => {
      controller.abort();
    };
  }, [merchantCountry]);

  // Clear stale city options inline during render when the selected state is
  // reset (react.dev "adjusting state when a prop changes" pattern — avoids a
  // synchronous setState-in-effect and the extra commit it forces).
  const [prevCityFetchState, setPrevCityFetchState] = useState(newAddressState);
  if (newAddressState !== prevCityFetchState) {
    setPrevCityFetchState(newAddressState);
    if (!newAddressState) {
      setShippingCities([]);
    }
  }

  // Fetch Cities when State changes. NG-only: the /api/shipping/locations city
  // dataset is Nigerian. Non-NG cities come from the typed address via
  // inferAddressLocationFromInput's rawCity (no list lookup needed), so a NG
  // city fetch must never fire for a non-NG address.
  useEffect(() => {
    if (merchantCountry !== 'NG' || !newAddressState) {
      return;
    }
    const fetchCities = async () => {
      try {
        const res = await fetch(
          `/api/shipping/locations?state=${encodeURIComponent(newAddressState)}`
        );
        if (res.ok) {
          const data = await res.json();
          // Extract unique cities from the locations
          const cities = [
            ...new Set((data.locations as ShippingLocation[]).map((l) => l.city)),
          ].sort();
          setShippingCities(cities);
        }
      } catch (error) {
        console.error('Failed to fetch cities', error);
      }
    };
    fetchCities();
  }, [merchantCountry, newAddressState]);

  // Function to fetch quotes. The async core (with its try/finally and
  // synchronous loading-state writes) lives in module-scope
  // `loadShippingQuotes` so neither the compiler nor the effect below trips
  // on it; this wrapper only forwards inputs and setters.
  const fetchShippingQuotes = (
    address: string,
    state: string,
    city: string,
    phone: string,
    receiverFirstName: string,
    receiverLastName: string,
    email: string,
    deliveryPreference: 'door' | 'pickup_station' = 'door',
    force = true,
  ) =>
    merchant?.id
      ? loadCheckoutShippingQuotes(
          {
            address,
            state,
            city,
            phone,
            fName: receiverFirstName,
            lName: receiverLastName,
            email,
            merchantId: merchant.id,
            deliveryPreference,
            latitude: deliveryCoordinates?.latitude,
            longitude: deliveryCoordinates?.longitude,
            // Domestic (v1): the destination country is the merchant's own
            // country so merchant rate zones match; checkout keeps the free-text
            // state. `getCountryByCode` accepts a code or falls back to Nigeria.
            countryCode: merchantCountry,
            country: getCountryByCode(merchantCountry)?.name ?? 'Nigeria',
            // Catalog (pre-negotiation) basis so free-over / price-tier merchant
            // rates quote at the same tier the order-time fee guard verifies.
            cartSubtotal: checkoutCartCatalogSubtotal,
          },
          checkoutCart,
          {
            activeAbortController: quoteAbortController,
            currentRequestKey: resolvedQuoteRequestKey,
            force,
            requestSequence: quoteRequestSequence,
            setResolvedQuoteRequestKey,
            setIsLoadingQuotes,
            setSelectedQuoteId,
            setShippingQuotes,
          },
        )
      : resetQuotesForAddressChange();

  const isNewDeliveryAddressReady = isCheckoutDeliveryAddressReady({
    address: newAddressStreet,
    city: newAddressCity,
    state: newAddressState,
    country: getCountryByCode(merchantCountry)?.name ?? 'Nigeria',
  });

  // Trigger provider quotes only for a hydrated, complete delivery address.
  useEffect(() => {
    if (!isHydrated) return;
    if (deliveryMethod === 'door' || deliveryMethod === 'pickup_station') {
      if (!merchant?.id) {
        resetQuotesForAddressChange();
        return;
      }

      if (isNewAddressMode) {
        if (isNewDeliveryAddressReady) {
          fetchShippingQuotes(
            newAddressStreet,
            newAddressState,
            newAddressCity,
            customerPhone,
            firstName,
            lastName,
            customerEmail,
            deliveryMethod === 'pickup_station' ? 'pickup_station' : 'door',
            false,
          );
        } else {
          resetQuotesForAddressChange();
        }
      } else {
        const saved = addresses.find((a) => a.id === selectedAddressId);
        if (saved) {
          // Attempt to extract state/city from saved address string
          // Logic: "Address, City, State" or just "Address" (risky)
          // Improved logic: Try to match against shippingStates if possible, or just send last parts
          const parts = saved.address.split(',').map((s) => s.trim());

          if (parts.length >= 2) {
            const stateCandidate = parts[parts.length - 1];
            const cityCandidate = parts[parts.length - 2];

            // Basic verification: is stateCandidate in our shippingStates list? 
            // (Might be empty if not loaded yet, so just send it)
            if (stateCandidate && cityCandidate) {
              fetchShippingQuotes(
                saved.address,
                stateCandidate,
                cityCandidate,
                saved.phone,
                firstName,
                lastName,
                customerEmail,
                deliveryMethod === 'pickup_station' ? 'pickup_station' : 'door',
                false,
              );
            }
          }
        }
      }
    }
  }, [
    deliveryMethod,
    selectedAddressId,
    isNewAddressMode,
    // Manual typing clears the detected location until the debounce settles.
    isHydrated,
    isNewDeliveryAddressReady,
    newAddressStreet,
    newAddressState,
    newAddressCity,
    // Trigger if we switch back to a saved address
    addresses,
    merchant?.id,
    quoteItemsFingerprint,
    resolvedQuoteRequestKey,
    deliveryCoordinates?.latitude,
    deliveryCoordinates?.longitude,
    // Re-quote when the canonical CATALOG subtotal shifts without the item
    // fingerprint changing — e.g. toggling assurance or changing an assurance
    // rate. That basis is what free-over / price-tier merchant rates quote
    // against and what `/api/orders` recomputes the fee guard from, so a stale
    // fee here would fail-closed a legitimate cart. Derived from cart state, so
    // it is stable between renders and never loops.
    checkoutCartCatalogSubtotal,
  ]);


  // Wallet state (2025: auto-apply when balance > 0)
  const [walletBalance, setWalletBalance] = useState(0);
  const [walletLoading, setWalletLoading] = useState(false);
  const [payWithWallet, setPayWithWallet] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [orderTotals, setOrderTotals] = useState<{ total: number; taxAmount: number } | null>(null);
  const [appliedDiscount, setAppliedDiscount] =
    useState<DiscountResult | null>(null);

  // Note: currentStep and completedSteps are now part of checkoutForm (persisted)

  // Pay For Me State
  const [payForMeDetails, setPayForMeDetails] = useState({
    name: '',
    contact: '',
    note: '',
  });

  // Prefill user data if logged in
  useEffect(() => {
    if (user) {
      if (user.email && !customerEmail) setCustomerEmail(user.email);

      // Auto-fill name if not set
      if (!firstName && !lastName) {
        if (user.user_metadata?.first_name || user.user_metadata?.last_name) {
          setFirstName(user.user_metadata.first_name || '');
          setLastName(user.user_metadata.last_name || '');
        } else if (user.user_metadata?.full_name) {
          const parts = user.user_metadata.full_name.split(' ');
          setFirstName(parts[0] || '');
          setLastName(parts.slice(1).join(' ') || '');
        } else if (user.user_metadata?.name) {
          const parts = user.user_metadata.name.split(' ');
          setFirstName(parts[0] || '');
          setLastName(parts.slice(1).join(' ') || '');
        }
      }

      if (user.user_metadata?.phone && !customerPhone) {
        setCustomerPhone(user.user_metadata.phone);
      }
    }
  }, [user, customerEmail, firstName, lastName, customerPhone]);

  // Fetch wallet balance for logged-in customers (2025 best practice:
  // auto-apply at checkout). The async try/finally flow lives in module-scope
  // `loadWalletBalance` so the compiler can memoize this component.
  useEffect(() => {
    if (!user || !merchant?.slug) return;

    const abortController = new AbortController();
    loadWalletBalance({
      merchantSlug: merchant.slug,
      signal: abortController.signal,
      setWalletLoading,
      setWalletBalance,
      setPayWithWallet,
    });

    return () => abortController.abort();
  }, [user, merchant?.slug]);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  // Date Calculation for Door Delivery
  const getDeliveryDateRange = () => {
    const today = new Date();
    const start = new Date(today);
    start.setDate(today.getDate() + 1);
    const end = new Date(today);
    end.setDate(today.getDate() + 3);

    const options: Intl.DateTimeFormatOptions = {
      day: 'numeric',
      month: 'short',
    };
    return `${start.toLocaleDateString('en-GB', options)} to ${end.toLocaleDateString('en-GB', options)}`;
  };

  const deliveryCost = calculateDeliveryCost(
    deliveryMethod,
    selectedQuoteId,
    shippingQuotes,
    airportType,
  );

  // Server-computed discount amount (the route re-validates against the
  // canonical subtotal); fall back to a local estimate only if it's missing.
  const discountAmount = appliedDiscount
    ? (appliedDiscount.discount_amount ??
      (appliedDiscount.discount_type === 'percentage'
        ? Math.round(
            effectiveCheckoutCartTotal * (appliedDiscount.discount_value / 100)
          )
        : Math.min(appliedDiscount.discount_value, effectiveCheckoutCartTotal)))
    : 0;
  // `total` is NET of the discount so wallet credit, remaining-amount gating,
  // the displayed total, and the order payload all agree.
  const total = Math.max(
    0,
    effectiveCheckoutCartTotal +
      deliveryCost +
      giftWrappingCost +
      (orderTotals?.taxAmount ?? 0) -
      discountAmount
  );

  // Wallet credit calculation (2025: can't redeem more than order total).
  // The customer wallet is an NGN-denominated ledger, so redemption is only
  // offered on NGN orders — mirrors the server-side guard in /api/orders.
  const walletCurrencySupported = currencyCode === 'NGN';
  const walletAmountUsed =
    payWithWallet && walletCurrencySupported
      ? Math.min(walletBalance, total)
      : 0;
  const remainingAmount = total - walletAmountUsed;


  const taxRate = merchant?.vat_registration_status === 'registered'
    ? (merchant.vat_rate ?? 7.5) / 100
    : 0;

  useEffect(() => {
    const fetchTotals = async () => {
      try {
        const result = await calculateCommerce('calculate_order', {
          subtotal: effectiveItemSubtotal,
          shippingFee: deliveryCost,
          taxRate,
        });
        setOrderTotals(result);
      } catch (err) {
        console.error("Failed to fetch totals from brain", err);
      }
    };
    fetchTotals();
  }, [effectiveItemSubtotal, deliveryCost, taxRate]);

  // Handler for direct payment execution (CredPal/Credit Direct)
  const executeDirectPayment = async () => {
    if (!resumedOrder || !preferredGateway) return;

    setIsProcessing(true);
    try {
      const paymentAmount = resumedOrder.total;

      // For CredPal, use the inline checkout widget (statically imported —
      // dynamic `import()` expressions bail React Compiler)
      if (preferredGateway === 'credpal') {
        const productNames = resumedOrder.items.map(item => item.product_name).join(', ') || 'Purchase';

        await openCredPalCheckout({
          key: getCredPalKey(),
          amount: paymentAmount,
          product: productNames,
          customerEmail: resumedOrder.customer_email,
          customerName: resumedOrder.customer_name,
          customerPhone: resumedOrder.customer_phone,
          onSuccess: async (data) => {
            // Update order with payment reference
            await fetch(`/api/orders/update-payment-ref`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                orderId: resumedOrder.id,
                paymentRef: data.order_no,
                gateway: 'credpal',
              }),
            });
            clearCheckoutSession();
            const successQuery = new URLSearchParams({
              orderId: resumedOrder.id,
              type: 'credpal',
            });
            if (resumedOrder.tracking_token) {
              successQuery.set('trackingToken', resumedOrder.tracking_token);
            }
            router.push(
              asRoute(getHref(`/order-success?${successQuery.toString()}`))
            );
          },
          onError: (error) => {
            toast({
              title: 'Payment Failed',
              description: error.message || 'CredPal payment failed',
              variant: 'destructive',
            });
            setIsProcessing(false);
          },
          onClose: () => {
            setIsProcessing(false);
          },
        });
        return;
      }

      // For Credit Direct, use their checkout widget (statically imported —
      // dynamic `import()` expressions bail React Compiler)
      if (preferredGateway === 'credit_direct') {
        await openCreditDirectCheckout({
          merchantSlug: merchant?.slug || 'ogabassey',
          orderId: resumedOrder.id,
          trackingToken: resumedOrder.tracking_token ?? '',
          amount: paymentAmount,
          customerEmail: resumedOrder.customer_email,
          customerPhone: resumedOrder.customer_phone,
          customerName: resumedOrder.customer_name,
          items: resumedOrder.items.map(item => ({
            id: item.product_id,
            name: item.product_name,
            price: item.price,
            quantity: item.quantity,
          })),
          onSuccess: ({ checkoutTransactionId, sessionId }) => {
            const trackingToken =
              resumedOrder.tracking_token || resumeTrackingToken;
            const merchantSlug =
              merchant?.slug || resumeMerchantSlug || 'ogabassey';
            const completionMarker = captureCreditDirectClientCompletion({
              orderId: resumedOrder.id,
              checkoutTransactionId,
              customerEmail: resumedOrder.customer_email,
              sessionId,
              trackingToken,
            });
            router.push(
              asRoute(
                getHref(
                  buildCreditDirectVerificationPath({
                    orderId: resumedOrder.id,
                    merchantSlug,
                    completionMarker,
                    trackingToken,
                    customerEmail: resumedOrder.customer_email,
                  })
                )
              )
            );
          },
          onError: (error) => {
            toast({
              title: 'Payment Failed',
              description: error || 'Credit Direct payment failed',
              variant: 'destructive',
            });
            setIsProcessing(false);
          },
          onClose: () => {
            setIsProcessing(false);
          },
          onPopup: async ({ checkoutTransactionId, sessionId }) => {
            writeCreditDirectPopupMarker(
              resumedOrder.id,
              checkoutTransactionId || sessionId
            );
            if (!checkoutTransactionId) {
              return;
            }
            try {
              await persistCreditDirectPopupReference(
                resumedOrder,
                checkoutTransactionId
              );
            } catch (error) {
              console.error(
                'Failed to persist Credit Direct popup reference:',
                error instanceof Error ? error.message : error
              );
            }
          },
        });
        return;
      }
    } catch (error) {
      console.error('Payment execution error:', error);
      setIsProcessing(false);
    }
  };

  // Auto-trigger payment for resumed orders
  useEffect(() => {
    if (resumedOrder && preferredGateway && !autoTriggerRef.current && !isProcessing) {
      autoTriggerRef.current = true;
      executeDirectPayment();
    }
  }, [resumedOrder, preferredGateway]);

  useEffect(() => {
    if (
      pendingCheckoutOrder &&
      merchant?.id &&
      pendingCheckoutOrder.merchantId !== merchant.id
    ) {
      clearPendingCheckoutOrder();
    }
  }, [pendingCheckoutOrder, merchant?.id, clearPendingCheckoutOrder]);

  const handlePlaceOrder = async () => {
    // Double-submit protection: prevent race conditions from rapid clicks
    if (isOrderInFlightRef.current) {
      return;
    }
    isOrderInFlightRef.current = true;

    if (!merchant?.id) {
      toast({
        title: 'Error',
        description: 'Merchant context not available. Please try again.',
        variant: 'destructive',
      });
      isOrderInFlightRef.current = false;
      return;
    }

    if (!customerEmail || !firstName || !lastName) {
      toast({
        title: 'Missing Information',
        description: 'Please fill in your name and email.',
        variant: 'destructive',
      });
      isOrderInFlightRef.current = false;
      return;
    }

    // Handle resumed orders from mobile app (order already exists, just need payment)
    if (resumedOrder && preferredGateway) {
      setIsProcessing(true);
      // Promise `.finally()` instead of a try/finally statement, which would
      // bail React Compiler; semantics are identical.
      await executeDirectPayment().finally(() => {
        isOrderInFlightRef.current = false;
      });
      return;
    }

    if (
      (deliveryMethod === 'door' || deliveryMethod === 'pickup_station') &&
      !selectedQuoteId
    ) {
      toast({
        title: 'Select Delivery Option',
        description: 'Please select a delivery option before placing your order.',
        variant: 'destructive',
      });
      setCurrentStep('delivery');
      setCompletedSteps((prev) => ({ ...prev, delivery: false }));
      isOrderInFlightRef.current = false;
      return;
    }

    // Note: `airportType` is typed as `'delivery' | 'pickup'` with a
    // 'delivery' default, so an explicit `!airportType` guard here would be
    // unreachable. Airport flow validation lives in `isDeliveryValid`.

    if (paymentMethod === 'bank_transfer' && !bankTransferCheckoutAvailable) {
      toast({
        title: 'Payment Unavailable',
        description:
          'Bank transfer is not available for this store yet. Please choose a different payment method.',
        variant: 'destructive',
      });
      isOrderInFlightRef.current = false;
      return;
    }

    if (paymentMethod === 'paystack' && !paystackCheckoutAvailable) {
      toast({
        title: 'Payment Unavailable',
        description:
          'Paystack is not available for this store yet. Please choose a different payment method.',
        variant: 'destructive',
      });
      isOrderInFlightRef.current = false;
      return;
    }

    if (paymentMethod === 'korapay' && !korapayCheckoutAvailable) {
      toast({
        title: 'Payment Unavailable',
        description:
          'Korapay is not available for this store yet. Please choose a different payment method.',
        variant: 'destructive',
      });
      isOrderInFlightRef.current = false;
      return;
    }

    if (
      isKlumpUnavailableForGatewayAmount({
        paymentMethod,
        payableAmount: remainingAmount,
        orderAmount: total,
      })
    ) {
      toast(KLUMP_WALLET_CREDIT_UNAVAILABLE_TOAST);
      setIsProcessing(false);
      isOrderInFlightRef.current = false;
      return;
    }

    setIsProcessing(true);

    const selectedAddress = addresses.find((a) => a.id === selectedAddressId);

    // Construct address string properly based on delivery method
    let finalAddress = 'Address not provided';
    let finalCity = '';
    let finalState = '';

    // Only require full address for door delivery
    if (deliveryMethod === 'door') {
      if (isNewAddressMode) {
        if (!newAddressStreet || !newAddressCity || !newAddressState) {
          toast({
            title: 'Incomplete Address',
            description: 'Please enter your full address (Street, City, State).',
            variant: 'destructive',
          });
          setIsProcessing(false);
          setCompletedSteps((prev) => ({ ...prev, delivery: false }));
          isOrderInFlightRef.current = false;
          setCurrentStep('delivery');
          return;
        }
        finalAddress = newAddressStreet;
        finalCity = newAddressCity;
        finalState = newAddressState;
      } else {
        finalAddress = selectedAddress?.address || 'Address not provided';
        // Try to parse city/state from saved string if possible
        const parts = finalAddress.split(',');
        if (parts.length >= 2) {
          finalState = parts[parts.length - 1]?.trim() || '';
          finalCity = parts[parts.length - 2]?.trim() || '';
        }
      }
    } else if (deliveryMethod === 'pickup_station') {
      const quote = shippingQuotes.find(
        (q) => String(q.id) === String(selectedQuoteId),
      );
      finalAddress =
        (quote && getStationPickupAddressText(quote)) ||
        quote?.displayName ||
        'GIGL pickup station';
      finalCity = newAddressCity;
      finalState = newAddressState;
      if ((!finalCity || !finalState) && selectedAddress?.address) {
        const parts = selectedAddress.address.split(',');
        if (parts.length >= 2) {
          finalCity ||= parts[parts.length - 2]?.trim() || '';
          finalState ||= parts[parts.length - 1]?.trim() || '';
        }
      }
    } else if (deliveryMethod === 'pickup') {
      finalAddress = 'Pickup at Store';
      finalCity = 'Lagos';
      finalState = 'Lagos';
    } else if (deliveryMethod === 'airport') {
      const airportAddress = resolveAirportShippingAddress({
        airportType,
        manualAddress: newAddressStreet,
        manualCity: newAddressCity,
        manualState: newAddressState,
        savedAddress: selectedAddress?.address,
      });
      finalAddress = airportAddress.address;
      finalCity = airportAddress.city;
      finalState = airportAddress.state;
    }

    const shippingAddressData = {
      address: finalAddress,
      city: finalCity,
      state: finalState,
      phone: customerPhone || selectedAddress?.phone || '',
      // Persist the merchant country so stored orders and the immediate
      // invoice/receipt carry the real country instead of the downstream `NG`
      // fallback — a non-NG (IN/AE) order is quoted+charged for the merchant
      // country and must be invoiced for it too. Mirrors the country the
      // shipping quote request already sends. NG orders now carry
      // 'Nigeria'/'NG' explicitly, which is exactly what the fallback assumed.
      countryCode: merchantCountry,
      country: getCountryByCode(merchantCountry)?.name ?? 'Nigeria',
    };

    // Identify selected shipping provider.
    //
    // B3 (plan §5 B3): only door delivery has a third-party shipping
    // provider with an associated quote. Pickup and airport are
    // delivery-method labels, not shipping providers — sending them
    // would trip the RPC's `shipping_quote_required` guard (which
    // exists to catch the legacy `|| 'GIGL'` silent-default bug).
    // The `delivery_method` field carries the customer-visible label
    // separately; admin order views can still show "Pickup"/"Airport".
    let shippingProvider: string | null = null;
    let trackingNumber = undefined;

    // Merchant-configured rate selection (id `mrate_<uuid>`). When present the
    // order takes the RPC null-provider bypass and sends `shipping_rate_id`
    // instead; the route recomputes the fee from rate config server-side.
    //
    // Only the QUOTED methods (`door`/`pickup_station`) carry a merchant rate.
    // Guard the extraction so a stale `mrate_<uuid>` left in `selectedQuoteId`
    // after switching to legacy `pickup`/`airport` (which submit
    // `selected_quote_id: null` + `shipping_fee: 0`) never leaks a
    // `shipping_rate_id` into the body — that would make /api/orders treat a
    // store-pickup/airport checkout as a merchant-rate order and reject it with
    // `SHIPPING_FEE_MISMATCH` (paid rate) or route the wrong provider (free
    // rate). Mirrors how `getForwardableSelectedQuoteId` restricts
    // `selected_quote_id` to the same two methods.
    const merchantRateId =
      deliveryMethod === 'door' || deliveryMethod === 'pickup_station'
        ? getMerchantRateId(selectedQuoteId)
        : null;

    // Prepare order items for API
    const orderItems = buildCheckoutOrderItems(checkoutCart);

    // B3 review fix #2 (PR #1611): door delivery without ANY quote
    // must bail BEFORE the JSON body is built. Pre-fix this submitted
    // `shipping_provider: null + selected_quote_id: null` (or empty
    // string), which slips past the RPC's `provider != null AND
    // quote_id IS NULL` guard (both null → guard doesn't fire) and
    // persists a silent zero-shipping order. Mirrors the pre-submit
    // block in `place-order.ts`. Treat empty string as no quote too —
    // the state hook initializes selectedQuoteId to `''` (line ~573).
    if (
      (deliveryMethod === 'door' || deliveryMethod === 'pickup_station') &&
      !selectedQuoteId
    ) {
      toast({
        title: 'Delivery option required',
        description: 'Please select a delivery option to continue.',
        variant: 'destructive',
      });
      isOrderInFlightRef.current = false;
      setIsProcessing(false);
      return;
    }

    if (
      (deliveryMethod === 'door' ||
        deliveryMethod === 'pickup_station' ||
        (deliveryMethod === 'airport' && selectedQuoteMatchesDeliveryMethod)) &&
      selectedQuoteId
    ) {
      if (selectedQuote && selectedQuoteMatchesDeliveryMethod) {
        // Merchant rates take the null-provider path (fee recomputed from rate
        // config); only carrier quotes stamp a bookable provider.
        shippingProvider = merchantRateId ? null : selectedQuote.provider; // e.g. 'GIGL', 'Topship'
      } else {
        // B3 review fix #1: do NOT fabricate a 'Standard' provider —
        // selectedQuoteId is dangling (stored id with no matching
        // quote in the current rate list, usually because rates
        // expired or were refreshed under us). Surface a validation
        // error and bail; never submit a quote id with no resolvable
        // provider.
        toast({
          title: 'Shipping rate expired',
          description: 'Please select a delivery option again.',
          variant: 'destructive',
        });
        isOrderInFlightRef.current = false;
        setIsProcessing(false);
        return;
      }
    }

    const normalizedPaymentMethod = normalizeOrderPaymentMethod(paymentMethod);
    const checkoutFingerprint = buildPendingCheckoutFingerprint({
      merchantId: merchant.id,
      customerEmail,
      customerName: `${firstName} ${lastName}`.trim(),
      customerPhone,
      deliveryMethod,
      shippingFee: deliveryCost,
      shippingProvider,
      selectedQuoteId:
        deliveryMethod === 'door' ||
        deliveryMethod === 'pickup_station' ||
        (deliveryMethod === 'airport' && selectedQuoteMatchesDeliveryMethod)
          ? selectedQuoteId || undefined
          : undefined,
      shippingAddress: shippingAddressData,
      items: orderItems.map((item) => ({
        product_id: item.product_id,
        name: item.name,
        quantity: item.quantity,
        price: item.price,
        has_assurance: item.has_assurance,
        assurance_fee: item.assurance_fee,
        variantId: item.variantId,
        variantAttributes: item.variantAttributes,
      })),
      useWalletCredit: payWithWallet && walletAmountUsed > 0,
      walletAmountUsed,
      discountCode: appliedDiscount?.code ?? null,
    });

    try {
      let order: {
        id: string;
        order_number?: string;
        tracking_token?: string;
        /** Stamped orders.currency (returned by /api/orders and /api/orders/reuse). */
        currency?: string | null;
      };
      let walletResult: {
        amountUsed: number;
        newBalance: number;
      } | null = null;
      let amountDueToGateway = total;

      const reusablePendingOrder = await resolvePendingCheckoutOrder({
        pendingOrder: pendingCheckoutOrder,
        merchantId: merchant.id,
        merchantSlug: merchant.slug,
        customerEmail,
        checkoutFingerprint,
        paymentMethod: normalizedPaymentMethod,
        shippingProvider,
        // Airport (GIGL GoFaster) forwards its real carrier quote id only when
        // the current selection matches the airport method. Door/pickup use
        // `getForwardableSelectedQuoteId`, which additionally omits a merchant
        // rate's synthetic `mrate_<uuid>` id — the reuse route validates
        // `selected_quote_id` as a UUID and would 400 (clearing the stored
        // pending order). Reuse reopens an already-fee-verified order and does
        // not re-verify shipping, so omitting the id is safe.
        selectedQuoteId:
          deliveryMethod === 'airport'
            ? selectedQuoteMatchesDeliveryMethod
              ? selectedQuoteId || undefined
              : undefined
            : getForwardableSelectedQuoteId(deliveryMethod, selectedQuoteId),
        // R14-3: forward the BARE merchant rate id so the reuse route can
        // re-stamp fulfillment metadata if the original stamp failed. This is
        // the null-provider path's identity (selected_quote_id stays omitted
        // above — the `mrate_` id is not a uuid the reuse schema accepts).
        shippingRateId: merchantRateId ?? undefined,
      });

      if (reusablePendingOrder.clearStoredOrder) {
        clearPendingCheckoutOrder();
      }

      if (reusablePendingOrder.reusableOrder) {
        order = reusablePendingOrder.reusableOrder.order;
        amountDueToGateway = reusablePendingOrder.reusableOrder.amountDueToGateway;
      } else {
        const checkoutIdempotencyKey =
          await getCheckoutIdempotencyKey(checkoutFingerprint);

        // 1. Create order in database via API (with wallet redemption if applicable)
        const orderResponse = await fetch('/api/orders', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Idempotency-Key': checkoutIdempotencyKey,
          },
          body: JSON.stringify({
            merchant_id: merchant.id,
            customer_email: customerEmail,
            customer_name: `${firstName} ${lastName}`.trim(),
            customer_phone: customerPhone,
            items: orderItems,
            subtotal: checkoutCartTotal,
            shipping_fee: deliveryCost,
            // B3.5 (Δ-31, Δ-34, Δ-39): pass the calculate-commerce
            // VAT figure AND the gift-wrapping fee AND the client's
            // expected total straight through to the API. No hidden
            // fallback math — pre-B3.5 this body omitted `tax_amount`
            // entirely so the RPC defaulted it to 0, the trigger
            // later overwrote `orders.tax_amount` from order_items
            // VAT, and `orders.total` was left stale: customer saw
            // ₦X (with VAT) but the row recorded ₦X-without-VAT.
            // The RPC enforces VAT itself (Δ-42) so any drift here
            // surfaces as `tax_amount_mismatch` 4xx, not silent.
            tax_amount: orderTotals?.taxAmount ?? 0,
            tax_basis: 'exclusive',
            gift_wrapping_fee: giftWrappingCost,
            // Client-side total snapshot for the API's parity check
            // (Δ-39). Must match the RPC formula:
            //   subtotal + shipping + gift + tax - discount.
            // The local `total` variable (line ~953) is
            // `orderTotals?.total || (cartTotal + deliveryCost +
            // giftWrappingCost)` — `orderTotals.total` from
            // `calculate_order` is `subtotal + shipping + tax` and
            // OMITS gift wrapping (the action's input is just
            // {subtotal, shippingFee, taxRate}, no gift param).
            // Sending `total` directly when orderTotals is present
            // would always trip ORDER_TOTAL_MISMATCH whenever
            // `giftWrappingCost > 1`. Compose the snapshot from the
            // explicit components instead so it always matches the
            // server side (Codex P1 on PR #1622).
            // Net of the applied discount so the RPC parity formula
            // (subtotal + shipping + gift + tax - discount) matches; the route
            // recomputes + validates the discount from the canonical subtotal.
            expected_total: Math.max(
              0,
              checkoutCartTotal +
                deliveryCost +
                giftWrappingCost +
                (orderTotals?.taxAmount ?? 0) -
                discountAmount
            ),
            client_total: Math.max(
              0,
              checkoutCartTotal +
                deliveryCost +
                giftWrappingCost +
                (orderTotals?.taxAmount ?? 0) -
                discountAmount
            ),
            ...(appliedDiscount?.code
              ? { discount_code: appliedDiscount.code }
              : {}),
            payment_method: normalizedPaymentMethod,
            payment_status: 'unpaid',
            shipping_status: 'pending',
            shipping_address: shippingAddressData,
            source: 'online_store',
            delivery_method: deliveryMethod,
            ...(deliveryMethod === 'airport' &&
            !selectedQuoteMatchesDeliveryMethod
              ? { airport_type: airportType }
              : {}),
            shipping_provider: shippingProvider,
            // Merchant-rate orders: send the bare rate id and force the null
            // shipping_provider/selected_quote_id path (there is no persisted
            // quote row to book). The route recomputes + verifies the fee.
            ...(merchantRateId ? { shipping_rate_id: merchantRateId } : {}),
            // B3 review fix (PR #1611): explicit null on the wire. The RPC
            // schema is `.nullable().optional()` so null is canonical. Merchant
            // rates always resolve to null here (they carry shipping_rate_id);
            // pickup/airport and an empty/dangling selection also resolve to
            // null. Shared with the reuse path so the two can't drift.
            selected_quote_id:
              deliveryMethod === 'airport'
                ? selectedQuoteMatchesDeliveryMethod
                  ? selectedQuoteId || null
                  : null
                : (getForwardableSelectedQuoteId(
                    deliveryMethod,
                    selectedQuoteId,
                  ) ?? null),
            // Wallet redemption (2025: auto-apply at checkout)
            use_wallet_credit: payWithWallet && walletAmountUsed > 0,
            wallet_amount: walletAmountUsed,
            // Link customer to auth user (2025: unified customer identity)
            user_id: user?.id,
            // Marketing Consent
            accepts_marketing: newsletterOptIn,
          }),
        });

        if (!orderResponse.ok) {
          const errorData = await orderResponse.json();
          const errorCode =
            typeof errorData.code === 'string' ? errorData.code : '';
          if (
            errorCode === 'CHECKOUT_ORDER_NOT_REUSABLE' ||
            errorCode === 'CHECKOUT_IDEMPOTENCY_CONFLICT'
          ) {
            clearPendingCheckoutOrder();
            await clearCheckoutIdempotencyKey(checkoutFingerprint);
          }
          // A quiz voucher rejected server-side (used / not-approved / expired)
          // would otherwise stick in the cart at ₦0 and re-fail every future
          // checkout. Prune ONLY the unredeemable line(s) so the shopper can
          // proceed — never a still-valid prize from a multi-voucher cart. A
          // sign-in-required rejection is excluded (voucher valid once signed
          // in); see selectRejectedVoucherLines for the full policy.
          for (const line of selectRejectedVoucherLines(cart, errorData)) {
            // removeFromCart matches a cartItemId directly, but its product-id
            // branch compares against item.id — so passing both a cartItemId
            // and a variantId never matches. Prefer the cartItemId alone; fall
            // back to (productId, variantId).
            if (line.cartItemId) {
              removeFromCart(line.cartItemId);
            } else {
              removeFromCart(line.id, line.variantId);
            }
          }
          console.error('Order creation failed:', {
            status: orderResponse.status,
            error: errorData.error,
            details: errorData.details,
            fullResponse: errorData
          });
          if (SHIPPING_RATE_REJECTION_CODES.has(errorCode)) {
            // The merchant re-priced / re-zoned their rate under us; ask the
            // customer to refresh so a fresh quote (and fee) is fetched.
            raiseCheckoutError(
              'Shipping cost changed — please refresh and try again.'
            );
          }
          raiseCheckoutError(getCheckoutOrderErrorMessage(errorData));
        }

        const orderData = await orderResponse.json();
        order = orderData.order;
        walletResult = orderData.wallet;
        amountDueToGateway = orderData.amountDueToGateway ?? total;
      }

      // The ORDER row's stamped currency is authoritative for payment
      // initialization: a reused/idempotent order keeps its original currency
      // even if the merchant's payout currency changed after it was created,
      // and the initialize API rejects an explicit client/order mismatch.
      // Both order sources return it (/api/orders and /api/orders/reuse);
      // fall back to the merchant-resolved code only if it is ever absent.
      const orderChargeCurrency =
        typeof order.currency === 'string' && order.currency.trim()
          ? order.currency.trim().toUpperCase()
          : currencyCode;

      // 1b. Create account if requested (Awaited to ensure session is set before moving to next page)
      if (createAccount && !user && accountPassword.length >= 6) {
        try {
          const supabase = createClient();
          await supabase.auth.signUp({
            email: customerEmail,
            password: accountPassword,
            options: {
              data: {
                first_name: firstName,
                last_name: lastName,
                phone: customerPhone,
                source: 'checkout',
                signup_type: 'customer'  // Prevents merchant record creation
              }
            }
          });
          console.log('Account created and session initialized');
        } catch (authError) {
          // Log but don't block the order if signup fails (e.g. email exists)
          console.error('Silent signup background error:', authError);
        }
      }

      const pendingSnapshot: PendingCheckoutOrderSnapshot = {
        orderId: order.id,
        orderNumber: order.order_number,
        trackingToken: order.tracking_token,
        merchantId: merchant.id,
        customerEmail,
        customerPhone,
        checkoutFingerprint,
        amountDueToGateway,
        createdAt: new Date().toISOString(),
      };
      persistPendingCheckoutOrder(pendingSnapshot);
      setPendingCheckoutOrder(pendingSnapshot);

      const paymentAmount = amountDueToGateway ?? total;

      if (
        isKlumpUnavailableForGatewayAmount({
          paymentMethod,
          payableAmount: paymentAmount,
          orderAmount: total,
        })
      ) {
        toast(KLUMP_WALLET_CREDIT_UNAVAILABLE_TOAST);
        setIsProcessing(false);
        isOrderInFlightRef.current = false;
        return;
      }

      // Update local wallet balance if redemption occurred
      if (walletResult?.amountUsed) {
        setWalletBalance(walletResult.newBalance);
      }

      const billingAddress = buildCheckoutBillingAddress(finalAddress, finalCity, finalState, merchantCountry);

      // 2. Handle payment based on method
      // Special case: If wallet fully covers the order, no payment gateway needed
      // Order API already marks it as paid, just redirect to success
      if (paymentAmount <= 0) {
        clearPendingCheckoutOrder();
        await clearCheckoutIdempotencyKey(checkoutFingerprint);
        clearCheckoutSession();
        // Defer clearCart to avoid flashing empty state before redirect
        const successQuery = new URLSearchParams({
          orderId: order.id,
          wallet: 'true',
        });
        if (order.tracking_token) {
          successQuery.set('trackingToken', order.tracking_token);
        }
        router.push(asRoute(getHref(`/order-success?${successQuery.toString()}`)));
        setTimeout(clearCart, 500);
        return;
      }

      if (paymentMethod === 'bank_transfer') {
        // Wallet-funded transfer FIRST for signed-in customers of an
        // auto-debit merchant (flag-gated). `start` resolves false for every
        // decline — guest, merchant flag off, no phone, consent denied, 5xx —
        // and we then run the untouched legacy order-DVA path.
        //
        // Await the AUTHORITATIVE session value first: the storefront session
        // fetch is async, so reading a still-`loading` state here would treat a
        // signed-in customer who submits promptly after page load as a guest and
        // route them to legacy DVA. `waitForResolvedAuthenticated` blocks on the
        // in-flight fetch (fail-closed to guest on error) so the branch decision
        // is only made once the session is known.
        const storefrontCustomerAuthenticated =
          await waitForResolvedStorefrontCustomerAuth();
        const walletFundedOutcome =
          merchant &&
          isEligibleForWalletFundedBankTransfer({
            isAuthenticated: storefrontCustomerAuthenticated,
            merchantId: merchant.id,
            orderCurrency: orderChargeCurrency,
            paymentAmount,
            walletOrderAutoDebitWebEnabled: isWalletOrderAutoDebitWebEnabled(),
          })
            ? await walletFundedTransfer.start({
                checkoutFingerprint,
                merchantId: merchant.id,
                merchantSlug: merchant.slug ?? undefined,
                orderId: order.id,
                trackingToken: order.tracking_token,
              })
            : ('fallback' as const);

        if (walletFundedOutcome === 'started') {
          setIsProcessing(false);
          isOrderInFlightRef.current = false;
          return;
        }

        if (walletFundedOutcome === 'uncertain') {
          // Money-safety: the create-intent POST outcome is indeterminate — the
          // server may already hold a funding intent for this order. Do NOT open
          // the legacy order-DVA path (a second funding channel risks a double
          // charge); prompt the customer to check their wallet and retry.
          toast({
            title: 'We could not confirm your transfer setup',
            description:
              'Please check your wallet balance before trying again. Do not start another payment for this order yet.',
            variant: 'destructive',
          });
          setIsProcessing(false);
          isOrderInFlightRef.current = false;
          return;
        }

        await handleBankTransfer(order, paymentAmount, billingAddress);
        return;
      }

      if (paymentMethod === 'paystack' || paymentMethod === 'korapay' || paymentMethod === 'juicyway' || paymentMethod === 'klump') {
        // For Juicyway crypto payments, show the selector first
        if (paymentMethod === 'juicyway') {
          setPendingCryptoOrder({
            orderId: order.id,
            trackingToken: order.tracking_token,
            amount: paymentAmount,
            orderCurrency: orderChargeCurrency,
            customerEmail,
            customerName: `${firstName} ${lastName}`.trim(),
            customerPhone,
            billingAddress,
            items: checkoutCart.map(item => ({
              name: item.name,
              type: 'physical' as const,
            })),
          });
          setShowCryptoSelector(true);
          setIsProcessing(false);
          isOrderInFlightRef.current = false;
          return;
        }

        // Initialize payment via API - supports Paystack and Korapay
        // Amount is adjusted for wallet credit (if used)
        const paymentResponse = await fetch('/api/payments/initialize', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            merchant_id: merchant.id,
            order_id: order.id,
            currency: orderChargeCurrency,
            customer_email: customerEmail,
            customer_name: `${firstName} ${lastName}`.trim(),
            customer_phone: customerPhone,
            gateway: paymentMethod,
            billing_address: billingAddress,
          }),
        });

        if (!paymentResponse.ok) {
          const errorData = await paymentResponse.json();
          raiseCheckoutError(errorData.error || 'Payment initialization failed');
        }

        const paymentResult = await paymentResponse.json();

        if (paymentResult.success && paymentResult.crypto_payment) {
          // Juicyway crypto payment - show wallet address modal
          setCryptoPaymentData({
            address: paymentResult.crypto_payment.address,
            chain: paymentResult.crypto_payment.chain,
            currency: paymentResult.crypto_payment.currency,
            amount: paymentResult.crypto_payment.amount / 100, // Convert from minor units
            confirmation_time: paymentResult.crypto_payment.confirmation_time,
            orderId: order.id,
            trackingToken: order.tracking_token,
            reference: paymentResult.reference,
            sessionId: paymentResult.session_id || '',
            paymentId: paymentResult.crypto_payment.payment_id || '', // Payment ID for verification
          });
          setIsProcessing(false);
          isOrderInFlightRef.current = false;
          return;
        } else if (paymentResult.success && paymentResult.authorization_url) {
          // NOTE: Don't clear cart here - it causes a flash of empty state
          // Cart will be cleared on the payment callback page after successful payment
          // (location.assign over `href =` — global assignment bails React Compiler)
          window.location.assign(paymentResult.authorization_url);
          return;
        } else if (paymentResult.success && paymentResult.checkout_url) {
          // Juicyway uses checkout_url
          window.location.assign(paymentResult.checkout_url);
          return;
        } else {
          raiseCheckoutError('Payment initialization failed: No auth URL returned');
        }
      } else if (paymentMethod === 'credit_direct') {
        // Credit Direct BNPL - Client-side popup checkout
        // Note: BNPL typically uses full total (wallet credits may not apply)
        await openCreditDirectCheckout({
          merchantSlug: merchant.slug || '',
          orderId: order.id,
          trackingToken: order.tracking_token ?? '',
          amount: paymentAmount,
          customerEmail,
          customerPhone,
          customerName: `${firstName} ${lastName}`.trim(),

          // Weight the Credit Direct allocation by the CANONICAL order-item
          // prices (negotiated applied, quiz vouchers 0) — not displayItems,
          // whose price is the raw cart price. Using display prices would
          // finance a voucher-covered item and under-allocate a paid one.
          items: toCreditDirectItems(orderItems),
          onSuccess: ({ checkoutTransactionId, sessionId }) => {
            const completionMarker = captureCreditDirectClientCompletion({
              orderId: order.id,
              checkoutTransactionId,
              customerEmail,
              sessionId,
              trackingToken: order.tracking_token,
            });
            router.push(
              asRoute(
                getHref(
                  buildCreditDirectVerificationPath({
                    orderId: order.id,
                    merchantSlug: merchant.slug || '',
                    completionMarker,
                    trackingToken: order.tracking_token,
                    customerEmail,
                  })
                )
              )
            );
          },
          onError: (error) => {
            console.error('Credit Direct error:', error);
            toast({
              title: 'Credit Direct Failed',
              description: error || 'Credit Direct checkout failed. Please try again.',
              variant: 'destructive',
            });
            setIsProcessing(false);
            isOrderInFlightRef.current = false;
          },
          onClose: () => {
            setIsProcessing(false);
            isOrderInFlightRef.current = false;
          },
          onPopup: async ({ checkoutTransactionId, sessionId }) => {
            writeCreditDirectPopupMarker(
              order.id,
              checkoutTransactionId || sessionId
            );
            if (!checkoutTransactionId) {
              return;
            }
            try {
              await persistCreditDirectPopupReference(
                order,
                checkoutTransactionId
              );
            } catch (error) {
              console.error(
                'Failed to persist Credit Direct popup reference:',
                error instanceof Error ? error.message : error
              );
            }
          },
        });
        // Don't proceed further - callbacks handle the flow
        return;
      } else if (paymentMethod === 'credpal') {
        // CredPal BNPL - Client-side popup checkout
        const credpalKey = process.env.NEXT_PUBLIC_CREDPAL_KEY;

        if (!credpalKey) {
          // CredPal not configured - show error, don't proceed to success
          toast({
            title: 'CredPal Unavailable',
            description: 'CredPal payment is not available at this time. Please select a different payment method.',
            variant: 'destructive',
          });
          setIsProcessing(false);
          isOrderInFlightRef.current = false;
          return;
        }

        // Open CredPal popup
        await openCredPalCheckout({
          key: credpalKey,
          amount: paymentAmount,
          product: cart.map(item => item.name).join(', '),
          customerEmail,
          customerName: `${firstName} ${lastName}`.trim(),
          customerPhone,
          onSuccess: async (data) => {
            console.log('CredPal success:', data);
            clearPendingCheckoutOrder();
            await clearCheckoutIdempotencyKey(checkoutFingerprint);
            clearCheckoutSession();
            clearCart();
            const successQuery = new URLSearchParams({
              type: 'credpal',
              orderId: order.id,
              credpalRef: data.order_no,
            });
            if (order.tracking_token) {
              successQuery.set('trackingToken', order.tracking_token);
            }
            router.push(
              asRoute(getHref(`/order-success?${successQuery.toString()}`))
            );
          },
          onError: (error) => {
            console.error('CredPal error:', error);
            toast({
              title: 'CredPal Failed',
              description: error.message || 'CredPal checkout failed. Please try again.',
              variant: 'destructive',
            });
            setIsProcessing(false);
            isOrderInFlightRef.current = false;
          },
          onClose: () => {
            setIsProcessing(false);
            isOrderInFlightRef.current = false;
          },
        });
        // Don't proceed further - callbacks handle the flow
        return;
      } else if (paymentMethod === 'invoice') {
        // Invoice/Pay Later - order created, redirect to success
        clearPendingCheckoutOrder();
        await clearCheckoutIdempotencyKey(checkoutFingerprint);
        clearCheckoutSession();
        const successQuery = new URLSearchParams({
          type: 'invoice',
          orderId: order.id,
        });
        if (order.tracking_token) {
          successQuery.set('trackingToken', order.tracking_token);
        }
        router.push(asRoute(getHref(`/order-success?${successQuery.toString()}`)));
        setTimeout(clearCart, 500);
      } else if (paymentMethod === 'payforme') {
        // Pay For Me - TODO: send payment link
        clearPendingCheckoutOrder();
        await clearCheckoutIdempotencyKey(checkoutFingerprint);
        clearCheckoutSession();
        const successQuery = new URLSearchParams({
          type: 'payforme',
          orderId: order.id,
          payerName: payForMeDetails.name,
        });
        if (order.tracking_token) {
          successQuery.set('trackingToken', order.tracking_token);
        }
        router.push(asRoute(getHref(`/order-success?${successQuery.toString()}`)));
        setTimeout(clearCart, 500);
      } else {
        // Default: POD or other
        clearPendingCheckoutOrder();
        await clearCheckoutIdempotencyKey(checkoutFingerprint);
        clearCheckoutSession();
        const successQuery = new URLSearchParams({
          type: 'standard',
          orderId: order.id,
        });
        if (order.tracking_token) {
          successQuery.set('trackingToken', order.tracking_token);
        }
        router.push(asRoute(getHref(`/order-success?${successQuery.toString()}`)));
        setTimeout(clearCart, 500);
      }
    } catch (error) {
      console.error('Checkout error:', error);
      toast({
        title: 'Checkout Failed',
        description: error instanceof Error
          ? error.message
          : 'An error occurred. Please try again.',
        variant: 'destructive',
      });
      setIsProcessing(false);
      // Reset double-submit protection on error so user can retry
      isOrderInFlightRef.current = false;
      // Keep user on payment step - don't reset their progress
      setCurrentStep('payment');
      // Ensure steps stay completed so user doesn't have to re-enter info
      setCompletedSteps({ contact: true, delivery: true });
    }
  };

  // Dedicated Virtual Account (DVA) Handler. The fetch + throw flow lives in
  // module-scope `requestDvaInitialization`; the promise chain replaces
  // try/catch/finally, which would bail React Compiler.
  const handleBankTransfer = async (
    order: { id: string; currency?: string | null },
    paymentAmount: number,
    billingAddress: DvaBillingAddress
  ) => {
    if (!merchant) {
      isOrderInFlightRef.current = false;
      return;
    }

    setIsInitializingDva(true);
    await requestDvaInitialization({
      merchantId: merchant.id,
      orderId: order.id,
      customerEmail,
      customerName: `${firstName} ${lastName}`.trim(),
      customerPhone,
      billingAddress,
      // Stamped order currency is authoritative; fall back to the
      // merchant-resolved code only if the row value is ever absent.
      orderCurrency:
        typeof order.currency === 'string' && order.currency.trim()
          ? order.currency.trim().toUpperCase()
          : currencyCode,
    })
      .then((result) => {
        setDvaData({
          ...result.dva,
          amount: paymentAmount,
          reference: result.reference,
        });
        setDvaCountdown(3600);
        isOrderInFlightRef.current = false;
      })
      .catch((error: unknown) => {
        console.error('DVA initialization error:', error);
        toast({
          title: 'Bank Transfer Failed',
          description:
            error instanceof Error ? error.message : 'Failed to initialize bank transfer',
          variant: 'destructive',
        });
        isOrderInFlightRef.current = false;
      })
      .finally(() => {
        setIsProcessing(false);
        setIsInitializingDva(false);
      });
  };

  // Unified Next Step Handler for Mobile Action Bar
  const handleNextStep = () => {
    if (currentStep === 'contact') {
      // Validation Logic (Same as desktop button)
      setContactValidationAttempted(true);

      const trimmedFirstName = firstName.trim();
      const trimmedLastName = lastName.trim();
      const trimmedEmail = customerEmail.trim();

      // Validate all required fields
      const hasErrors = !trimmedFirstName || !trimmedLastName || !trimmedEmail || !customerPhone || !isValidPhoneNumber(customerPhone);

      if (hasErrors) return; // Inline errors will show

      // Basic email validation
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(trimmedEmail)) return;

      setCompletedSteps(prev => ({ ...prev, contact: true }));
      setCurrentStep('delivery');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } else if (currentStep === 'delivery') {
      setCompletedSteps(prev => ({ ...prev, delivery: true }));
      setCurrentStep('payment');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } else if (currentStep === 'payment') {
      handlePlaceOrder();
    }
  };

  const isPayForMeValid =
    paymentMethod === 'payforme'
      ? Boolean(payForMeDetails.name && payForMeDetails.contact)
      : true;

  // Loading state (Initial fetch OR waiting for auto-trigger)
  // This prevents the form from flashing briefly before the payment widget opens
  const isAutoTriggerProcessing = resumedOrder && !!preferredGateway && !isProcessing;

  if (isLoadingResumedOrder || isAutoTriggerProcessing) {
    return (
      <div className="ogabassey-checkout-page min-h-screen bg-gray-50/50 flex items-center justify-center pb-20">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="size-12 animate-spin text-store-primary" />
          <p className="text-gray-500 font-medium animate-pulse">
            {isLoadingResumedOrder ? 'Loading order...' : 'Initializing secure checkout...'}
          </p>
        </div>
      </div>
    );
  }

  // Error state for order resumption
  if (resumeOrderId && resumeOrderError) {
    return (
      <div className="ogabassey-checkout-page min-h-screen bg-gray-50/50 flex items-center justify-center pb-20">
        <div className="text-center max-w-md mx-auto px-4">
          <div className="size-20 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-6">
            <AlertCircle className="size-10 text-red-500" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Something Went Wrong</h1>
          <p className="text-gray-500 mb-6">{resumeOrderError}</p>
          <div className="flex flex-col gap-3">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="inline-flex items-center justify-center gap-2 px-6 py-3 bg-store-primary text-white font-semibold rounded-xl hover:bg-store-primary/90 transition-colors"
            >
              Try Again
            </button>
            <button
              type="button"
              onClick={() => router.push(asRoute(getHref('/')))}
              className="inline-flex items-center justify-center gap-2 px-6 py-3 border border-gray-300 text-gray-700 font-semibold rounded-xl hover:bg-gray-50 transition-colors"
            >
              Go to Homepage
            </button>
          </div>
          <p className="text-xs text-gray-400 mt-6">
            If this problem persists, please{' '}
            <button
              type="button"
              onClick={() => router.push(asRoute(getHref('/contact')))}
              className="text-store-primary underline"
            >
              contact support
            </button>
            .
          </p>
        </div>
      </div>
    );
  }

  // Empty cart check - only show after hydration confirms cart is genuinely empty
  // Skip this check when resuming an order (cart is empty during order resumption)




  // Chain display names and explorer URLs
  const chainDisplayNames: Record<string, string> = {
    TRX: 'Tron (TRC-20)',
    ETH: 'Ethereum (ERC-20)',
    MATIC: 'Polygon',
    AVAXC: 'Avalanche C-Chain',
  };

  const chainExplorerUrls: Record<string, string> = {
    TRX: 'https://tronscan.org/#/address/',
    ETH: 'https://etherscan.io/address/',
    MATIC: 'https://polygonscan.com/address/',
    AVAXC: 'https://snowtrace.io/address/',
  };

  return (
    <div className="ogabassey-checkout-page min-h-screen bg-gray-50/50 pb-20 flex flex-col">
      {/* Checkout Navbar */}
      <div className="sticky top-0 z-40 bg-white/90 backdrop-blur-md border-b border-gray-200/50 shadow-sm supports-[backdrop-filter]:bg-white/60">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <button type="button"
            onClick={() => router.push(asRoute(getHref('/cart')))}
            className="group flex items-center gap-2 text-sm font-medium text-gray-600 hover:text-store-primary transition-colors"
          >
            <div className="size-8 rounded-full bg-gray-100 flex items-center justify-center group-hover:bg-store-primary/5 transition-colors">
              <ChevronRight className="size-4 rotate-180 group-hover:text-store-primary transition-colors" />
            </div>
            <span className="hidden sm:inline">Return to Cart</span>
          </button>

          <div className="flex flex-col items-center">
            <div className="font-bold text-gray-900 tracking-tight flex items-center gap-2">
              <ShieldCheck className="size-4 text-green-600" />
              <span>Secure Checkout</span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="hidden sm:flex items-center gap-1.5 px-3 py-1 bg-green-50 text-green-700 text-xs font-medium rounded-full border border-green-100">
              <div className="size-1.5 rounded-full bg-green-500 animate-pulse" />
              Encrypted
            </div>
          </div>
        </div>
      </div>
      <CheckoutAuthModal
        isOpen={isAuthModalOpen}
        onOpenChange={setIsAuthModalOpen}
        onSuccess={() => setIsAuthModalOpen(false)}
      />

      {/* Crypto Selector Modal */}
      {showCryptoSelector && (
        <CryptoSelectorModal
          selectedCryptoCurrency={selectedCryptoCurrency}
          selectedCryptoChain={selectedCryptoChain}
          supportedChains={cryptoChainSupport[selectedCryptoCurrency]}
          isInitializingCrypto={cryptoInitializer.isInitializing}
          onCurrencyChange={(currency) => { cryptoInitializer.cancel(); handleCryptoCurrencyChange(currency); }}
          onChainChange={(chain) => { cryptoInitializer.cancel(); setSelectedCryptoChain(chain); }}
          onInitialize={initializeCryptoPayment}
          onClose={() => {
            cryptoInitializer.cancel();
            setShowCryptoSelector(false);
            setPendingCryptoOrder(null);
            isOrderInFlightRef.current = false;
          }}
        />
      )}

      {/* Crypto Payment Modal */}
      {cryptoPaymentData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full max-h-[90vh] overflow-y-auto animate-in zoom-in-95 duration-200">
            {/* Header */}
            <div className="sticky top-0 bg-linear-to-r from-store-primary to-store-primary/80 p-4 flex items-center justify-between rounded-t-2xl">
              <div className="flex items-center gap-2">
                <div className="size-8 bg-white/20 rounded-lg flex items-center justify-center">
                  <CreditCard size={16} className="text-white" />
                </div>
                <h2 className="font-bold text-white">Pay with Crypto</h2>
              </div>
              <button
                type="button"
                onClick={() => {
                  // Just close the modal - don't clear cart or redirect
                  // User can retry or choose a different payment method
                  setCryptoPaymentData(null);
                  setCryptoVerificationStatus('idle');
                  setIsVerifyingCrypto(false);
                }}
                className="size-8 rounded-lg bg-white/20 flex items-center justify-center text-white hover:bg-white/30 transition-colors"
              >
                <X size={16} />
              </button>
            </div>

            {/* Content */}
            <div className="p-5 space-y-4">
              {/* Top Row: QR & Amount */}
              <div className="flex gap-4 items-center">
                {/* QR Code (Compact) */}
                <div className="bg-white p-2 rounded-xl shadow-sm border border-gray-200">
                  <img
                    src={cryptoPaymentData.qrcode || `https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${cryptoPaymentData.address}&margin=10`}
                    alt="Scan"
                    className="size-24"
                    loading="lazy"
                  />
                </div>

                {/* Payment Details */}
                <div className="flex-1 space-y-2">
                  <div>
                    <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Send Exactly</p>
                    <p className="text-2xl font-black text-gray-900 leading-tight">
                      {cryptoPaymentData.amount.toLocaleString()} <span className="text-store-primary">{cryptoPaymentData.currency}</span>
                    </p>
                  </div>
                  <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-gray-100 border border-gray-200">
                    <span className="size-1.5 rounded-full bg-green-500 animate-pulse" />
                    <p className="text-xs font-semibold text-gray-700">
                      Network: {chainDisplayNames[cryptoPaymentData.chain] || cryptoPaymentData.chain}
                    </p>
                  </div>
                </div>
              </div>

              {/* Wallet Address (Merged Copy) */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest pl-1">
                  Recipient Address
                </label>
                <div className="relative group">
                  <div className="w-full bg-gray-50 border border-gray-200 rounded-xl py-3 pl-3 pr-12 font-mono text-xs text-gray-600 break-all">
                    {cryptoPaymentData.address}
                  </div>
                  <button
                    type="button"
                    onClick={() => copyToClipboard(cryptoPaymentData.address)}
                    className={`absolute right-1 top-1 bottom-1 px-3 bg-white border rounded-lg shadow-sm transition-all flex items-center justify-center group-hover:shadow-md ${copiedText === cryptoPaymentData.address
                      ? 'border-green-300 text-green-600'
                      : 'border-gray-200 hover:border-store-primary/40 hover:text-store-primary'
                      }`}
                    title={copiedText === cryptoPaymentData.address ? 'Copied!' : 'Copy Address'}
                  >
                    {copiedText === cryptoPaymentData.address ? <Check size={16} /> : <Copy size={16} />}
                  </button>
                </div>
              </div>

              {/* Warning (Compact) */}
              <div className="bg-amber-50 border border-amber-100 rounded-lg p-3">
                <p className="text-[11px] leading-relaxed text-amber-800">
                  <strong className="font-bold">Warning:</strong> Only send <span className="font-bold">{cryptoPaymentData.currency}</span> on the <span className="font-bold">{chainDisplayNames[cryptoPaymentData.chain] || cryptoPaymentData.chain}</span> network. Using the wrong network will result in permanent loss.
                </p>
              </div>

              {/* Confirmation Time */}
              <div className="flex items-center gap-3 bg-store-primary/5 rounded-xl p-4 border border-store-primary/20">
                <div className="size-10 bg-store-primary/10 rounded-full flex items-center justify-center shrink-0">
                  <Clock size={20} className="text-store-primary" />
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-900">Expected confirmation</p>
                  <p className="text-xs text-gray-500">{cryptoPaymentData.confirmation_time}</p>
                </div>
              </div>

              {/* Reference */}
              <div className="text-center text-xs text-gray-400">
                Reference: {cryptoPaymentData.reference}
              </div>

              {/* Verification Status */}
              {isVerifyingCrypto && (
                <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-center">
                  <div className="flex items-center justify-center gap-2 mb-2">
                    <Loader2 size={18} className="animate-spin text-blue-600" />
                    <span className="text-sm font-medium text-blue-800">
                      {cryptoVerificationStatus === 'checking' && 'Checking payment status...'}
                      {cryptoVerificationStatus === 'pending' && 'Waiting for blockchain confirmation...'}
                    </span>
                  </div>
                  <p className="text-xs text-blue-600">
                    This may take a few minutes. Do not close this window.
                  </p>
                </div>
              )}

              {cryptoVerificationStatus === 'confirmed' && (
                <div className="bg-green-50 border border-green-200 rounded-xl p-4 text-center">
                  <p className="text-sm font-medium text-green-800">
                    Payment confirmed! Redirecting to order confirmation…
                  </p>
                </div>
              )}

              {cryptoVerificationStatus === 'failed' && (
                <div className="bg-store-primary/5 border border-store-primary/30 rounded-xl p-4 text-center">
                  <p className="text-sm font-medium text-red-800">
                    Payment verification failed. Please contact support.
                  </p>
                </div>
              )}

              {/* Verify Payment Button */}
              <button
                type="button"
                onClick={verifyCryptoPayment}
                disabled={isVerifyingCrypto}
                className={`w-full py-3.5 font-bold rounded-xl transition-colors shadow-lg ${isVerifyingCrypto
                  ? 'bg-gray-400 text-gray-200 cursor-not-allowed'
                  : 'bg-store-primary text-white hover:bg-store-primary/90 shadow-store-primary/20'
                  }`}
              >
                {isVerifyingCrypto ? (
                  <span className="flex items-center justify-center gap-2">
                    <Loader2 size={18} className="animate-spin" />
                    Verifying Payment…
                  </span>
                ) : (
                  "I've Sent the Payment"
                )}
              </button>

              <p className="text-center text-xs text-gray-400">
                Click the button above after sending. We'll verify the payment on the blockchain.
              </p>

              {/* Close without verifying */}
              {!isVerifyingCrypto && (
                <button
                  type="button"
                  onClick={() => {
                    const confirmed = confirm(
                      'Are you sure you want to close? If you\'ve already sent payment, your order will still be processed once the payment is detected.'
                    );
                    if (confirmed) {
                      setCryptoPaymentData(null);
                      setCryptoVerificationStatus('idle');
                    }
                  }}
                  className="w-full py-2.5 text-gray-500 text-sm font-medium hover:text-gray-700 transition-colors"
                >
                  Close and check order status later
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Wallet-funded bank transfer (P4a): consent, then the customer's own
          standing wallet account number — money in, wallet credited, order
          auto-debited. Legacy order-DVA modal below is untouched. */}
      {walletFundedTransfer.consentRequested && (
        <WalletTransferConsentDialog
          merchantName={merchant?.business_name || 'This store'}
          onAccept={walletFundedTransfer.acceptConsent}
          onDecline={walletFundedTransfer.declineConsent}
        />
      )}

      {walletFundedTransfer.account && walletFundedTransfer.intent && (
        <WalletFundedTransferModal
          account={walletFundedTransfer.account}
          copiedText={copiedText}
          error={walletFundedTransfer.error}
          formatCurrency={formatCurrencyAuto}
          intent={walletFundedTransfer.intent}
          isChecking={walletFundedTransfer.isChecking}
          onCheckNow={walletFundedTransfer.checkNow}
          onClose={walletFundedTransfer.close}
          onCopy={copyToClipboard}
        />
      )}

      {/* Dedicated Virtual Account (DVA) Modal */}
      {dvaData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full max-h-[90vh] overflow-y-auto animate-in zoom-in-95 duration-200">
            {/* Header */}
            <div className="sticky top-0 bg-linear-to-r from-store-primary to-store-primary/80 p-6 flex items-center justify-between rounded-t-2xl">
              <div className="flex items-center gap-3">
                <div className="size-10 bg-white/20 rounded-xl flex items-center justify-center">
                  <Building2 size={20} className="text-white" />
                </div>
                <div>
                  <h2 className="font-bold text-white leading-none">Bank Transfer</h2>
                  <p className="text-white/70 text-xs mt-1">Automatic verification</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setDvaData(null)}
                className="size-8 rounded-lg bg-white/20 flex items-center justify-center text-white hover:bg-white/30 transition-colors"
              >
                <X size={16} />
              </button>
            </div>

            {/* Content */}
            <div className="p-6 space-y-6">
              {/* Amount to Pay */}
              <div className="text-center p-4 bg-gray-50 rounded-2xl border border-gray-100">
                <p className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-1">Send Exactly</p>
                <p className="text-3xl font-black text-gray-900">
                  {formatCurrencyAuto(dvaData.amount)}
                </p>
              </div>

              {/* Bank Details */}
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest pl-1">
                    Account Number
                  </label>
                  <div className="relative group">
                    <div className="w-full bg-gray-50 border border-gray-200 rounded-xl py-4 px-4 font-mono text-xl font-bold text-gray-900 tracking-wider">
                      {dvaData.account_number}
                    </div>
                    <button
                      type="button"
                      onClick={() => copyToClipboard(dvaData.account_number)}
                      className={`absolute right-2 top-2 bottom-2 px-4 bg-white border rounded-lg shadow-sm transition-all flex items-center justify-center group-hover:shadow-md ${copiedText === dvaData.account_number
                        ? 'border-green-300 text-green-600'
                        : 'border-gray-200 hover:border-store-primary/40 hover:text-store-primary'
                        }`}
                    >
                      {copiedText === dvaData.account_number ? <Check size={18} /> : <Copy size={18} />}
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div className="bg-gray-50 p-3 rounded-xl border border-gray-100">
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Bank Name</p>
                    <p className="font-bold text-gray-900">{dvaData.bank_name}</p>
                  </div>
                  <div className="bg-gray-50 p-3 rounded-xl border border-gray-100">
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Account Name</p>
                    <p className="font-bold text-gray-900 truncate">{dvaData.account_name}</p>
                  </div>
                </div>
              </div>

              {/* Instruction & Timer */}
              <div className="bg-blue-50 border border-blue-100 rounded-2xl p-4 flex gap-4">
                <div className="size-10 bg-white rounded-xl flex items-center justify-center shadow-sm shrink-0">
                  <Clock size={20} className="text-blue-600" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-blue-900">Transfer expires in 60:00</h4>
                  <p className="text-xs text-blue-700 mt-1 leading-relaxed">
                    Make your transfer within the next hour. Your order will be confirmed automatically once the payment is detected.
                  </p>
                </div>
              </div>

              {/* Waiting Status */}
              <div className="flex flex-col items-center justify-center py-4 gap-3">
                <div className="flex items-center gap-3 text-store-primary">
                  <div className="flex gap-1">
                    <div className="size-1.5 bg-store-primary rounded-full animate-bounce [animation-delay:-0.3s]" />
                    <div className="size-1.5 bg-store-primary rounded-full animate-bounce [animation-delay:-0.15s]" />
                    <div className="size-1.5 bg-store-primary rounded-full animate-bounce" />
                  </div>
                  <span className="text-sm font-bold">Waiting for transfer…</span>
                </div>
                <p className="text-[10px] text-gray-400 text-center">
                  Reference: {dvaData.reference}
                </p>
              </div>

              {/* Buttons */}
              <div className="space-y-3">
                <button
                  type="button"
                  onClick={() => window.location.reload()}
                  className="w-full py-4 bg-store-primary text-white font-bold rounded-xl hover:bg-store-primary/90 transition-colors shadow-lg shadow-store-primary/20"
                >
                  Confirm Transfer Sent
                </button>
                <button
                  type="button"
                  onClick={() => setDvaData(null)}
                  className="w-full py-2.5 text-gray-500 text-sm font-medium hover:text-gray-700 transition-colors"
                >
                  Close and check later
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-2xl font-black text-gray-900 flex items-center gap-3">
            <span className="size-10 bg-store-primary text-white rounded-xl flex items-center justify-center shadow-store-primary/20 shadow-lg">
              <ShieldCheck size={20} />
            </span>
            Secure Checkout
          </h1>
          <div className="flex items-center gap-2 text-sm text-gray-500 bg-white px-3 py-1.5 rounded-full border border-gray-100 shadow-sm">
            <div className="size-2 rounded-full bg-green-500 animate-pulse" />
            SSL Encrypted
          </div>
        </div>

        {/* MOBILE ORDER SUMMARY (Collapsible) */}
        {/* MOBILE ORDER SUMMARY (Collapsible) */}
        <MobileOrderSummary
          cart={mobileSummaryCart}
          cartTotal={effectiveCheckoutCartTotal}
          deliveryCost={resumedOrder ? resumedOrder.shipping_cost : deliveryCost}
          taxAmount={resumedOrder?.tax_amount ?? orderTotals?.taxAmount ?? 0}
          discountAmount={resumedOrder?.discount_amount ?? discountAmount}
          deliveryMethod={resumedOrder ? null : deliveryMethod}
          giftWrappingCost={giftWrappingCost}
          walletBalance={walletBalance}
          payWithWallet={payWithWallet}
          walletAmountUsed={walletAmountUsed}
          remainingAmount={resumedOrder?.total ?? remainingAmount}
        />

        {/* Hidden in the resumed-order flow: that path charges the persisted
            resumedOrder.total and skips order creation, so a discount applied
            here would only change the displayed total/fingerprint, not the
            amount actually charged. */}
        {!resumedOrder && (
          <div className="mt-4">
            <DiscountCodeInput
              merchantId={merchant?.id || ''}
              cartTotal={effectiveCheckoutCartTotal}
              currencyCountryCode={merchant?.country ?? 'NG'}
              payoutCurrency={merchant?.payout_currency ?? null}
              productIds={checkoutCart.map((item) => item.id)}
              appliedDiscount={appliedDiscount}
              onApply={setAppliedDiscount}
              onRemove={() => setAppliedDiscount(null)}
            />
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12">
          {/* LEFT COLUMN: Accordion Steps */}
          <div className="lg:col-span-8 space-y-6">

            {/* Auth Banner for Guests (2026 Best Practice) */}
            {!user && currentStep === 'contact' && (
              <div className="bg-blue-50 border border-blue-100 rounded-2xl p-4 flex items-center justify-between animate-in fade-in slide-in-from-top-2 duration-500">
                <div className="flex items-center gap-3">
                  <div className="size-10 bg-white rounded-xl flex items-center justify-center shadow-sm">
                    <User size={20} className="text-blue-600" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-gray-900">Already have an account?</h4>
                    <p className="text-xs text-gray-500">Sign in to use your saved addresses and track orders.</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setIsAuthModalOpen(true)}
                  className="px-4 py-2 bg-white text-blue-600 font-bold text-xs rounded-lg border border-blue-200 hover:bg-blue-50 transition-colors shadow-sm active:scale-95"
                >
                  Sign In
                </button>
              </div>
            )}

            {/* Accordion Step 1: Contact Information */}
            <div className={`bg-white rounded-2xl shadow-sm border ${currentStep === 'contact' ? 'border-store-primary ring-1 ring-store-primary/20' : 'border-gray-100'} overflow-hidden transition-all duration-300`}>
              <button
                type="button"
                onClick={() => setCurrentStep('contact')}
                className="w-full px-6 py-4 flex items-center justify-between gap-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-store-primary focus-visible:ring-inset"
              >
                <div className="min-w-0">
                  <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                    <div className={`size-6 rounded-full flex items-center justify-center text-xs transition-colors ${completedSteps.contact ? 'bg-green-100 text-green-600' : currentStep === 'contact' ? 'bg-store-primary/10 text-store-primary' : 'bg-gray-100 text-gray-500'
                      }`}>
                      {completedSteps.contact ? <Check size={14} /> : '1'}
                    </div>
                    Contact Information
                  </h2>
                  {completedSteps.contact && currentStep !== 'contact' && (firstName || customerPhone) && (
                    <p className="mt-1 pl-8 text-xs font-normal text-gray-500 truncate">
                      {[firstName, lastName].filter(Boolean).join(' ')}
                      {customerPhone ? ` · ${customerPhone}` : ''}
                    </p>
                  )}
                </div>
                {completedSteps.contact && currentStep !== 'contact' && (
                  <span className="text-sm font-semibold text-store-primary underline-offset-4 hover:underline shrink-0">Edit</span>
                )}
              </button>

              {/* Collapsible Content */}
              <div className={`grid transition-all duration-300 ease-in-out ${currentStep === 'contact' ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}>
                <div className="overflow-hidden">
                  <div className="p-6 pt-0 space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-bold text-gray-700 uppercase tracking-wide mb-1.5">
                          First Name *
                        </label>
                        <input
                          type="text"
                          value={firstName}
                          onChange={(e) => setFirstName(e.target.value)}
                          placeholder="John"
                          className={`w-full px-4 py-3 bg-gray-50 border rounded-xl focus:outline-hidden text-sm text-gray-900 placeholder:text-gray-400 ${contactValidationAttempted && !firstName.trim()
                            ? 'border-red-500 focus:border-red-500 bg-store-primary/5'
                            : firstName.trim()
                              ? 'border-store-primary/40 focus:border-store-primary focus:ring-1 focus:ring-store-primary/20'
                              : 'border-gray-200 focus:border-store-primary focus:ring-1 focus:ring-store-primary/20'
                            }`}
                          required
                        />
                        {contactValidationAttempted && !firstName.trim() && (
                          <p className="text-red-500 text-xs mt-1">First name is required</p>
                        )}
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-gray-700 uppercase tracking-wide mb-1.5">
                          Last Name *
                        </label>
                        <input
                          type="text"
                          value={lastName}
                          onChange={(e) => setLastName(e.target.value)}
                          placeholder="Doe"
                          className={`w-full px-4 py-3 bg-gray-50 border rounded-xl focus:outline-hidden text-sm text-gray-900 placeholder:text-gray-400 ${contactValidationAttempted && !lastName.trim()
                            ? 'border-red-500 focus:border-red-500 bg-store-primary/5'
                            : lastName.trim()
                              ? 'border-store-primary/40 focus:border-store-primary focus:ring-1 focus:ring-store-primary/20'
                              : 'border-gray-200 focus:border-store-primary focus:ring-1 focus:ring-store-primary/20'
                            }`}
                          required
                        />
                        {contactValidationAttempted && !lastName.trim() && (
                          <p className="text-red-500 text-xs mt-1">Last name is required</p>
                        )}
                      </div>
                      <div className="md:col-span-2">
                        <label className="block text-xs font-bold text-gray-700 uppercase tracking-wide mb-1.5">
                          Email Address *
                        </label>
                        <input
                          type="email"
                          value={customerEmail}
                          onChange={(e) => setCustomerEmail(e.target.value)}
                          placeholder="john@example.com"
                          className={`w-full px-4 py-3 bg-gray-50 border rounded-xl focus:outline-hidden text-sm text-gray-900 placeholder:text-gray-400 ${contactValidationAttempted && (!customerEmail.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail.trim()))
                            ? 'border-red-500 focus:border-red-500 bg-store-primary/5'
                            : /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail.trim())
                              ? 'border-store-primary/40 focus:border-store-primary focus:ring-1 focus:ring-store-primary/20'
                              : 'border-gray-200 focus:border-store-primary focus:ring-1 focus:ring-store-primary/20'
                            }`}
                          required
                        />
                        {contactValidationAttempted && !customerEmail.trim() && (
                          <p className="text-red-500 text-xs mt-1">Email address is required</p>
                        )}
                        {contactValidationAttempted && customerEmail.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail.trim()) && (
                          <p className="text-red-500 text-xs mt-1">Please enter a valid email address</p>
                        )}
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-gray-700 uppercase tracking-wide mb-1.5">
                        Phone Number *
                      </label>
                      <div className={contactValidationAttempted && (!customerPhone || !isValidPhoneNumber(customerPhone)) ? "rounded-lg border border-red-500" : ""}>
                        <PhoneInput
                          value={customerPhone}
                          onChange={(value) => setCustomerPhone(value || '')}
                          placeholder="+234 800 000 0000"
                          defaultCountry="NG"
                          className="w-full text-sm"
                        />
                      </div>
                      {contactValidationAttempted && !customerPhone && (
                        <p className="text-red-500 text-xs mt-1">Phone number is required</p>
                      )}
                      {contactValidationAttempted && customerPhone && !isValidPhoneNumber(customerPhone) && (
                        <p className="text-red-500 text-xs mt-1">Please enter a valid phone number</p>
                      )}
                    </div>

                    {/* Guest Account Creation & Newsletter (2026 Conversion Pattern) */}
                    {!user && (
                      <div className="md:col-span-2 space-y-4 pt-4">

                        {/* 2. Account Creation Checkbox (Retention) */}
                        <div className={`bg-gray-50 rounded-xl p-4 border transition-all duration-300 ${createAccount ? 'border-store-primary/30 bg-store-primary/5' : 'border-gray-100 hover:border-store-primary/20'}`}>
                          <label className="flex items-start gap-3 cursor-pointer group mb-2">
                            <div className="relative flex items-center pt-0.5">
                              <input
                                type="checkbox"
                                checked={createAccount}
                                onChange={(e) => {
                                  setCreateAccount(e.target.checked);
                                  setShowPasswordInput(e.target.checked);
                                }}
                                className="peer size-5 rounded border-gray-300 text-store-primary focus:ring-store-primary"
                              />
                            </div>
                            <div>
                              <span className="block text-sm font-bold text-gray-900 group-hover:text-store-primary transition-colors">
                                Save my information for a faster checkout next time
                              </span>
                              <span className="text-xs text-gray-500 mt-0.5 block">
                                Securely save your address details for future orders.
                              </span>
                            </div>
                          </label>

                          {/* 3. Sliding Password Input */}
                          <div className={`overflow-hidden transition-all duration-300 ease-in-out ${showPasswordInput ? 'max-h-24 opacity-100 mt-3 pl-8' : 'max-h-0 opacity-0'}`}>
                            <label className="block text-xs font-bold text-gray-700 uppercase tracking-wide mb-1.5">
                              Create a Password
                            </label>
                            <div className="relative">
                              <input
                                type={isPasswordVisible ? "text" : "password"}
                                value={accountPassword}
                                onChange={(e) => setAccountPassword(e.target.value)}
                                placeholder="Min. 6 characters"
                                className={`w-full px-4 py-3 bg-white border rounded-xl focus:outline-hidden text-sm text-gray-900 placeholder:text-gray-400 pr-12 ${contactValidationAttempted && createAccount && accountPassword.length < 6
                                  ? 'border-red-500 focus:border-red-500'
                                  : 'border-gray-200 focus:border-store-primary'
                                  }`}
                              />
                              <button
                                type="button"
                                onClick={() => setIsPasswordVisible(!isPasswordVisible)}
                                className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                                aria-label="Show password"
                                aria-pressed={isPasswordVisible}
                              >
                                {isPasswordVisible ? (
                                  <EyeOff aria-hidden="true" size={18} />
                                ) : (
                                  <Eye aria-hidden="true" size={18} />
                                )}
                              </button>
                            </div>
                            {contactValidationAttempted && createAccount && accountPassword.length < 6 && (
                              <p className="text-red-500 text-xs mt-1">Password must be at least 6 characters</p>
                            )}
                          </div>
                        </div>
                      </div>
                    )}

                    <div className="pt-2">
                      <button
                        type="button"
                        onClick={() => {
                          setCompletedSteps(prev => ({ ...prev, contact: true }));
                          setCurrentStep('delivery');
                        }}
                        disabled={!isContactValid || (createAccount && accountPassword.length < 6)}
                        className="px-6 py-3 bg-store-primary text-white font-bold rounded-xl hover:bg-store-primary/90 transition-colors w-full md:w-auto disabled:bg-gray-300 disabled:text-gray-500 disabled:cursor-not-allowed shadow-lg disabled:shadow-none"
                      >
                        Continue to Delivery
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Step 2: Delivery Method */}
            <div className={`bg-white rounded-2xl shadow-sm border ${currentStep === 'delivery' ? 'border-store-primary ring-1 ring-store-primary/20' : 'border-gray-100'} transition-all duration-300`}>
              <button
                type="button"
                onClick={() => completedSteps.contact && setCurrentStep('delivery')}
                disabled={!completedSteps.contact}
                className="w-full px-6 py-4 flex items-center justify-between gap-3 text-left disabled:opacity-50 disabled:cursor-not-allowed hidden-disabled focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-store-primary focus-visible:ring-inset"
              >
                <div className="min-w-0">
                  <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                    <div className={`size-6 rounded-full flex items-center justify-center text-xs transition-colors ${completedSteps.delivery ? 'bg-green-100 text-green-600' : currentStep === 'delivery' ? 'bg-store-primary/10 text-store-primary' : 'bg-gray-100 text-gray-500'
                      }`}>
                      {completedSteps.delivery ? <Check size={14} /> : '2'}
                    </div>
                    Delivery Method
                  </h2>
                  {completedSteps.delivery && currentStep !== 'delivery' && (
                    <p className="mt-1 pl-8 text-xs font-normal text-gray-500 truncate">
                      {deliveryMethod === 'door'
                        ? 'By Road'
                        : deliveryMethod === 'pickup_station'
                          ? 'Pickup Station'
                        : deliveryMethod === 'pickup'
                          ? 'Store Pickup'
                            : 'By Air'}
                      {deliveryMethod === 'door' && newAddressCity ? ` · ${newAddressCity}` : ''}
                    </p>
                  )}
                </div>
                {completedSteps.delivery && currentStep !== 'delivery' && (
                  <span className="text-sm font-semibold text-store-primary underline-offset-4 hover:underline shrink-0">Edit</span>
                )}
              </button>

              <div className={`grid transition-all duration-300 ease-in-out ${currentStep === 'delivery' ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}>
                <div className={currentStep === 'delivery' ? 'overflow-visible' : 'overflow-hidden'}>
                  <div className="p-6 pt-0 space-y-4">
                    {/* STEP 1: Address Input FIRST */}
                    <div className="space-y-4">
                      {/* Saved Addresses (for logged in users) */}
                      {user && addresses.length > 0 && (
                        <div className="space-y-3">
                          <div className="flex items-center justify-between">
                            <label className="text-xs font-bold text-gray-700 uppercase tracking-wide">
                              Where should we deliver?
                            </label>
                            <button
                              type="button"
                              onClick={() => setIsNewAddressMode(!isNewAddressMode)}
                              className="text-xs font-bold text-store-primary hover:underline"
                            >
                              {isNewAddressMode ? 'Select Saved Address' : '+ New Address'}
                            </button>
                          </div>
                          {!isNewAddressMode && addresses.map((addr) => (
                            <label
                              key={addr.id}
                              className={`flex items-start p-4 rounded-xl border cursor-pointer transition-all focus-within:ring-2 focus-within:ring-store-primary focus-within:ring-offset-2 ${selectedAddressId === addr.id
                                ? 'border-store-primary bg-store-primary/5'
                                : 'border-gray-200 hover:border-gray-300'
                                }`}
                            >
                              <input
                                type="radio"
                                name="address"
                                checked={selectedAddressId === addr.id}
                                onChange={() => {
                                  setSelectedAddressId(addr.id);
                                  setIsNewAddressMode(false);
                                  clearInferredLocationDebounce();
                                  resetQuotesForAddressChange();
                                  // Extract state from saved address for eligibility checks
                                  const parts = addr.address.split(',').map(s => s.trim());
                                  if (parts.length >= 2) {
                                    setNewAddressState(parts[parts.length - 1] || '');
                                    setNewAddressCity(parts[parts.length - 2] || '');
                                  }
                                }}
                                className="mt-1 size-4 text-store-primary focus:ring-store-primary border-gray-300"
                              />
                              <div className="ml-3">
                                <p className="font-bold text-gray-900 text-sm">
                                  {addr.label || 'Saved Address'}
                                </p>
                                <p className="text-gray-600 text-sm mt-0.5">
                                  {addr.address}
                                </p>
                                <p className="text-gray-500 text-xs mt-1">
                                  {addr.phone}
                                </p>
                              </div>
                            </label>
                          ))}
                        </div>
                      )}

                      {/* New Address Form */}
                      {(isNewAddressMode || !user || addresses.length === 0) && (
                        <div className="space-y-4" style={{ overflow: 'visible' }}>
                          <label className="block text-xs font-bold text-gray-700 uppercase tracking-wide">
                            {user && addresses.length > 0 ? 'Enter New Address' : 'Delivery Address'}
                          </label>
                          <AddressAutocomplete
                            value={newAddressStreet}
                            useThemedInput={true}
                            onChange={(val) => {
                              const newVal = typeof val === 'string' ? val : val.target.value;
                              setCheckoutFields({
                                newAddressStreet: newVal,
                                newAddressCity: '',
                                newAddressState: '',
                                deliveryCoordinates: null,
                              });

                              // Reset state/city if address is cleared or changed significantly
                              if (!newVal || newVal.length < 10) {
                                clearInferredLocationDebounce();
                                setNewAddressState('');
                                setNewAddressCity('');
                                resetQuotesForAddressChange();
                                return;
                              }

                              // Fallback inference for manual address entry when autocomplete
                              // does not emit a structured onSelect payload.
                              const inferred = inferAddressLocationFromInput(
                                newVal,
                                shippingStates,
                                merchantCountry,
                              );
                              if (inferred) {
                                resetQuotesForAddressChange();
                                scheduleInferredLocationUpdate(inferred);
                              } else {
                                clearInferredLocationDebounce();
                                setCheckoutFields({
                                  newAddressCity: '',
                                  newAddressState: '',
                                });
                                resetQuotesForAddressChange();
                              }
                            }}
                            onSelect={(place: PlaceDetails) => {
                              clearInferredLocationDebounce();
                              resetQuotesForAddressChange();
                              setCheckoutFields({
                                newAddressStreet: place.formattedAddress,
                                newAddressState: place.state || '',
                                newAddressCity: place.city || '',
                                deliveryCoordinates:
                                  Number.isFinite(place.location?.latitude) &&
                                  Number.isFinite(place.location?.longitude)
                                    ? {
                                        latitude: place.location?.latitude ?? 0,
                                        longitude: place.location?.longitude ?? 0,
                                      }
                                    : null,
                              });
                            }}
                            placeholder="Start typing your address..."
                            country={merchantCountry}
                            className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl focus:outline-hidden focus-visible:ring-0 focus:border-store-primary text-sm text-gray-900 placeholder:text-gray-400"
                          />
                          {isHydrated && isNewDeliveryAddressReady && (
                            <p className="text-xs text-green-600 flex items-center gap-1">
                              <Check size={12} /> Detected: {newAddressCity}, {newAddressState}
                            </p>
                          )}
                        </div>
                      )}
                    </div>

                    {/* STEP 2: Delivery Method Cards - ONLY show AFTER address is detected */}
                    {isHydrated && (isNewDeliveryAddressReady || (!isNewAddressMode && selectedAddressId)) && (
                      <>
                        <div className="mt-6 pt-4 border-t border-gray-100">
                          <label className="block text-xs font-bold text-gray-700 uppercase tracking-wide mb-3">
                            How would you like to receive your order?
                          </label>
                          <div className="flex gap-3 overflow-x-auto pb-1">
                            {(['door', 'airport', 'pickup_station', 'pickup'] as const).map((method) => {
                              // Store ships from Lagos: the legacy in-store
                              // pickup is Lagos-only and airport is for non-Lagos
                              // states with an airport. Shared with the mobile
                              // storefront so they can't drift. Exception: a
                              // merchant/GIGL station quote reveals the
                              // provider-aware pickup_station tab even in Lagos,
                              // so merchant-configured pickup rates aren't hidden.
                              if (
                                method === 'pickup_station' &&
                                isPickupEligible(newAddressState) &&
                                !stationPickupQuote &&
                                !hasMerchantPickupQuote
                              ) {
                                return null;
                              }
                              if (
                                method === 'pickup' &&
                                (merchant?.slug !== 'ogabassey' ||
                                  !isPickupEligible(newAddressState) ||
                                  hasMerchantPickupQuote)
                              ) {
                                // Hide the hardcoded in-store pickup once the
                                // merchant configures its own pickup rate — the
                                // pickup_station tab renders it (avoids a
                                // duplicate "Store Pickup" affordance).
                                return null;
                              }
                              if (
                                method === 'airport' &&
                                !isAirportDeliveryEligible(newAddressState)
                              ) {
                                return null;
                              }

                              // Merchant `pickup` rates reuse the station-pickup
                              // tab with neutral (non-GIGL) copy.
                              const pickupStationCopy =
                                getPickupStationCopy(stationPickupQuote);
                              const Icon = method === 'door' ? Truck : method === 'airport' ? Plane : Building2;
                              const label =
                                method === 'door'
                                  ? 'By Road'
                                  : method === 'pickup_station'
                                    ? pickupStationCopy.methodLabel
                                    : method === 'pickup'
                                      ? 'Store Pickup'
                                      : 'By Air';
                              const subtitle =
                                method === 'door'
                                  ? 'To your address'
                                  : method === 'pickup_station'
                                    ? pickupStationCopy.methodSubtitle
                                    : method === 'pickup'
                                      ? 'Collect at store'
                                      : 'Via air cargo';

                              return (
                                <button type="button"
                                  key={method}
                                  onClick={() => selectDeliveryMethod(method)}
                                  className={`flex-1 flex flex-col items-center justify-center p-3 sm:p-4 rounded-xl border-2 transition-all gap-1 min-w-[100px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-store-primary focus-visible:ring-offset-2 ${deliveryMethod === method
                                    ? 'border-store-primary bg-store-primary/5 text-store-primary'
                                    : 'border-gray-100 bg-white text-gray-500 hover:border-gray-200 hover:bg-gray-50'
                                    }`}
                                >
                                  <Icon className={`size-6 ${deliveryMethod === method ? 'text-store-primary' : 'text-gray-400'}`} />
                                  <span className="text-xs sm:text-sm font-bold">{label}</span>
                                  <span className="text-[10px] text-gray-400">{subtitle}</span>
                                </button>
                              );
                            })}
                          </div>
                        </div>

                        {/* STEP 3: Delivery Method Details */}
                        {/* Pickup Info */}
                        {deliveryMethod === 'pickup' && (
                          <div className="mt-4 bg-gray-50 p-4 rounded-xl border border-gray-100 flex items-start gap-4 animate-in fade-in">
                            <div className="bg-white p-2 rounded-lg border border-gray-200">
                              <Building2 size={24} className="text-gray-600" />
                            </div>
                            <div>
                              <h4 className="font-bold text-gray-900 text-sm">Main Office Pickup</h4>
                              <p className="text-sm text-gray-600 mt-1">
                                Available for pickup at our Ikeja Store. Usually ready within 2 hours.
                              </p>
                              <div className="mt-2 text-xs font-mono bg-white inline-block px-2 py-1 rounded border border-gray-200 text-gray-500">
                                Pickup closes at 6 PM
                              </div>
                            </div>
                          </div>
                        )}

                        {deliveryMethod === 'pickup_station' &&
                          (isLoadingQuotes ? (
                            <SmartQuoteLoader />
                          ) : stationPickupQuotes.length > 0 ? (
                            // A merchant/GIGL zone can expose several pickup
                            // locations: render every one as an individually
                            // selectable option instead of collapsing to the
                            // first. Copy is provider-aware (GIGL vs merchant
                            // "Store Pickup") via getPickupStationCopy.
                            <fieldset className="m-0 mt-4 min-w-0 border-0 p-0 animate-in fade-in">
                              <legend className="mb-3 text-xs font-bold uppercase tracking-wide text-store-background-text/70">
                                {getPickupStationCopy(stationPickupQuote).detailHeading}
                              </legend>
                              <div className="space-y-3">
                                {stationPickupQuotes.map((quote) => (
                                  <label
                                    key={quote.id}
                                    className={`flex items-start justify-between gap-3 p-4 rounded-xl border cursor-pointer hover:border-store-primary/60 transition-all focus-within:ring-2 focus-within:ring-store-primary focus-within:ring-offset-2 ${selectedQuoteId === quote.id
                                      ? 'border-store-primary bg-store-primary/5 ring-1 ring-store-primary'
                                      : 'border-store-background-text/10 bg-store-background'
                                      }`}
                                  >
                                    <div className="flex min-w-0 items-start gap-3">
                                      <input
                                        type="radio"
                                        name="station_pickup_quote"
                                        checked={selectedQuoteId === quote.id}
                                        onChange={() => setSelectedQuoteId(quote.id)}
                                        className="mt-0.5 size-4 border-store-background-text/25 text-store-primary focus:ring-store-primary"
                                      />
                                      <div className="min-w-0">
                                        <span className="text-sm font-bold text-store-background-text">
                                          {quote.displayName}
                                        </span>
                                        <p className="mt-0.5 text-xs text-store-background-text/65">
                                          {quote.stationAddress ||
                                            getPickupStationCopy(quote).detailFallback}
                                        </p>
                                        {quote.stationInstructions && (
                                          <p className="mt-1 text-xs text-store-background-text/55">
                                            {quote.stationInstructions}
                                          </p>
                                        )}
                                      </div>
                                    </div>
                                    <span className="shrink-0 text-sm font-bold text-store-background-text">
                                      {formatAmountInCurrency(quote.price, quote.currency, AUTO_FRACTION_OPTIONS)}
                                    </span>
                                  </label>
                                ))}
                              </div>
                            </fieldset>
                          ) : (
                            <div className="mt-4 rounded-xl border border-store-background-text/10 bg-store-background p-4 text-sm text-store-background-text/65">
                              No nearby GIG Logistics pickup station is available for this address yet.
                            </div>
                          ))}

                        {/* Airport Options */}
                        {deliveryMethod === 'airport' && (
                          <AirportDeliveryOptions
                            airportType={airportType}
                            city={newAddressCity}
                            state={newAddressState}
                            selectedQuoteId={selectedQuoteId}
                            selectedQuoteMatchesDeliveryMethod={
                              selectedQuoteMatchesDeliveryMethod
                            }
                            airDeliveryQuotes={airDeliveryQuotes}
                            onSelectAirportType={(type) => {
                              setAirportType(type);
                              setSelectedQuoteId('');
                            }}
                            onSelectQuote={setSelectedQuoteId}
                          />
                        )}

                        {/* Door Delivery - Quote Selector */}
                        {deliveryMethod === 'door' && (
                          <DoorDeliveryQuoteOptions
                            isLoadingQuotes={isLoadingQuotes}
                            doorDeliveryQuotes={doorDeliveryQuotes}
                            stationPickupQuote={stationPickupQuote}
                            selectedQuoteId={selectedQuoteId}
                            onSelectQuote={setSelectedQuoteId}
                            onSelectStationPickup={(quoteId) => {
                              setSelectedQuoteId(quoteId);
                              setDeliveryMethod('pickup_station');
                            }}
                            onRefreshRates={() => {
                              if (isNewDeliveryAddressReady) {
                                fetchShippingQuotes(
                                  newAddressStreet,
                                  newAddressState,
                                  newAddressCity,
                                  customerPhone,
                                  firstName,
                                  lastName,
                                  customerEmail,
                                );
                              }
                            }}
                          />
                        )}
                      </>
                    )}

                    <div className="pt-2">
                      <button
                        type="button"
                        onClick={() => {
                          setCompletedSteps(prev => ({ ...prev, delivery: true }));
                          setCurrentStep('payment');
                        }}
                        className="w-full md:w-auto px-6 py-3 bg-store-primary text-white font-bold rounded-xl hover:bg-store-primary/90 transition-colors flex items-center justify-center gap-2 shadow-lg hover:shadow-store-primary/20 disabled:bg-gray-300 disabled:text-gray-500 disabled:cursor-not-allowed disabled:shadow-none"
                        disabled={!isDeliveryValid}
                      >
                        Continue to Payment
                        <ChevronRight size={18} />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Step 3: Payment Method */}
            <PaymentStep
              currentStep={currentStep}
              completedSteps={completedSteps}
              paymentTab={paymentTab}
              setPaymentTab={setPaymentTab}
              paymentMethod={paymentMethod}
              setPaymentMethod={setPaymentMethod}
              isProcessing={isProcessing}
              isPayForMeValid={isPayForMeValid}
              isDeliveryValid={isDeliveryValid}
              payForMeDetails={payForMeDetails}
              setPayForMeDetails={setPayForMeDetails}
              dva={{ isInitializingDva }}
              newsletterOptIn={newsletterOptIn}
              setNewsletterOptIn={setNewsletterOptIn}
              handlePlaceOrder={handlePlaceOrder}
              setCurrentStep={setCurrentStep}
              merchant={merchant}
              user={user}
              remainingAmount={remainingAmount}
              orderAmount={total}
              currency={currencyCode}
            />

          </div>

          {/* RIGHT COLUMN: Order Summary */}
          <div className="hidden lg:block lg:col-span-4 lg:sticky lg:top-24 space-y-6">
            <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
              <h2 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
                <span aria-hidden="true" className="flex size-6 items-center justify-center rounded-full bg-store-primary/10 text-store-primary">
                  <ShoppingBag size={13} />
                </span>
                Order Summary
              </h2>

              {/* Items List (Collapsed View). Keep the full scroll region
                  reserved so hydration of a multi-item persisted cart cannot
                  grow the summary and shift the payment controls. */}
              <div className="mb-6 h-[200px] space-y-4 overflow-y-auto pr-1">
                {displayItems.map((item) => {
                  // Legacy persisted carts can lack `cartItemId` until the
                  // provider's upgrade path (storefront-cart-provider.tsx
                  // `!item.cartItemId` branch) backfills it. Fall back to
                  // `item.id` so React keys never collapse to `undefined`.
                  const itemKey =
                    item.kind === 'cart'
                      ? item.cartItemId || item.id
                      : item.id;
                  const itemName = item.kind === 'cart' ? item.name : item.product_name;
                  const itemImage =
                    (item.kind === 'cart' ? item.image : item.image_url) || '/placeholder.png';
                  const isQuizGift =
                    item.kind === 'cart' && isQuizVoucherCartItem(item);
                  const itemPrice =
                    item.kind === 'cart'
                      ? getCartItemCheckoutUnitPrice(item)
                      : item.price;
                  return (
                    <div key={itemKey} className="flex gap-3">
                      <div className="ogabassey-product-card-image-surface relative size-12 bg-gray-50 rounded-lg border border-gray-100 p-1 shrink-0">
                        <CdnFormatImage
                          src={itemImage}
                          alt={itemName}
                          fill
                          sizes="48px"
                          className="object-contain mix-blend-multiply"
                        />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-gray-900 line-clamp-1">
                          {itemName}
                        </p>
                        <div className="flex justify-between items-center text-xs text-gray-500 mt-0.5">
                          <span>Qty: {item.quantity}</span>
                          <span>
                            {isQuizGift
                              ? 'Free gift'
                              : formatCurrencyAuto(itemPrice)}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="border-t border-dashed border-gray-200 my-4" />

              <div className="space-y-3 mb-6">
                <div className="flex justify-between text-gray-600 text-sm">
                  <span>Subtotal</span>
                  <span>{formatCurrencyAuto(effectiveCheckoutCartTotal)}</span>
                </div>
                {orderTotals && (
                  <div className="flex justify-between text-gray-600 text-sm">
                    <span>VAT (7.5%)</span>
                    <span>{formatCurrencyAuto(orderTotals.taxAmount)}</span>
                  </div>
                )}
                <div className="flex justify-between text-gray-600 text-sm">
                  <span>Delivery</span>
                  <span
                    className={
                      deliveryCost === 0
                        ? 'text-green-600 font-bold'
                        : 'text-gray-900'
                    }
                  >
                    {deliveryMethod === 'door' && !selectedQuoteId && deliveryCost === 0
                      ? <span className="text-gray-500 font-normal italic">Calculated…</span>
                      : deliveryCost === 0 ? 'Free' : formatCurrencyAuto(deliveryCost)}
                  </span>
                </div>
                {giftWrappingCost > 0 && (
                  <div className="flex justify-between text-gray-600 text-sm">
                    <span>Gift Wrapping</span>
                    <span>{formatCurrencyAuto(giftWrappingCost)}</span>
                  </div>
                )}

                {/* Wallet Credit Section (2025: progressive disclosure - only show if balance > 0 or loading). NGN-ledger: hidden on non-NGN orders. */}
                {walletCurrencySupported && (walletLoading || walletBalance > 0) && user && (
                  <div className="py-2 animate-in fade-in">
                    {walletLoading ? (
                      <div className="flex items-center gap-2 text-gray-500">
                        <Loader2 className="size-4 animate-spin" />
                        <span className="text-sm">Checking wallet balance…</span>
                      </div>
                    ) : (
                      <>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <div className="size-6 rounded-full bg-green-100 flex items-center justify-center">
                              <span className="text-green-600 text-xs font-bold">{currencySymbol}</span>
                            </div>
                            <div>
                              <span className="text-sm font-medium text-gray-700">Wallet Credit</span>
                              <span className="text-xs text-gray-500 ml-1">({formatCurrencyAuto(walletBalance)} available)</span>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => setPayWithWallet(!payWithWallet)}
                            className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-hidden ${payWithWallet ? 'bg-green-600' : 'bg-gray-300'
                              }`}
                          >
                            <span
                              className={`inline-block size-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${payWithWallet ? 'translate-x-4' : 'translate-x-0'
                                }`}
                            />
                          </button>
                        </div>
                        {payWithWallet && walletAmountUsed > 0 && (
                          <div className="flex justify-between text-green-700 text-sm font-medium mt-2 pl-8">
                            <span>Applied Credit</span>
                            <span>-{formatCurrencyAuto(walletAmountUsed)}</span>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}

                <div className="border-t border-dashed border-gray-200 my-2" />

                {/* Total or Amount Due */}
                <div className="flex justify-between text-gray-900 font-bold text-lg">
                  <span>
                    {remainingAmount > 0 && payWithWallet
                      ? 'Amount Due'
                      : 'Total'}
                  </span>
                  <span>{formatCurrencyAuto(remainingAmount)}</span>
                </div>
              </div>

              {/* Newsletter Opt-in (Moved to Summary Card) */}
              {!user && (
                <label className="flex items-start gap-3 cursor-pointer group mb-4 px-1">
                  <div className="relative flex items-center pt-0.5">
                    <input
                      id="newsletter-summary-opt-in"
                      type="checkbox"
                      checked={newsletterOptIn}
                      onChange={(e) => setNewsletterOptIn(e.target.checked)}
                      className="peer size-4 rounded border-gray-300 text-store-primary focus:ring-store-primary"
                    />
                  </div>
                  <span className="text-xs text-gray-600 group-hover:text-gray-900 transition-colors">
                    Email me with exclusive offers and new product drops.
                  </span>
                </label>
              )}

              <button
                type="button"
                onClick={handlePlaceOrder}
                disabled={
                  isProcessing ||
                  (remainingAmount > 0 && !paymentMethod) ||
                  (paymentMethod === 'payforme' && !isPayForMeValid)
                }
                className="hidden lg:flex w-full bg-store-primary hover:bg-store-primary/90 disabled:bg-gray-300 disabled:text-gray-500 disabled:cursor-not-allowed text-white font-bold py-3.5 px-4 rounded-xl items-center justify-center gap-2 transition-all shadow-lg hover:shadow-store-primary/20 active:scale-[0.98]"
              >
                {isProcessing ? (
                  <Loader2 className="animate-spin" />
                ) : paymentMethod === 'invoice' ? (
                  'Generate Invoice'
                ) : paymentMethod === 'payforme' ? (
                  'Send Payment Link'
                ) : (
                  'Place Order'
                )}
                {!isProcessing && <ChevronRight size={20} />}
              </button>

              <div className="mt-4 flex items-center justify-center gap-2 text-xs text-green-600 font-medium">
                <ShieldCheck size={14} /> Secure Encrypted Payment
              </div>
            </div>
          </div>
        </div>
      </div>

    </div >
  );
};
