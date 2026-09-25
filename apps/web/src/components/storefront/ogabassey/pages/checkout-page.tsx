'use client';
import { buildCheckoutOrderRequest } from './checkout/build-checkout-order-request';
import { useLoadResumedOrder } from './checkout/hooks/use-load-resumed-order';

import { useAirportQuoteRecovery } from './checkout/hooks/use-airport-quote-recovery';
import {
  useDvaConfirmTransfer,
  type DvaModalData,
} from './checkout/hooks/use-dva-confirm-transfer';
import { isAirportDeliveryReady } from './checkout/is-airport-delivery-ready';
import { canShowDeliveryMethods } from './checkout/can-show-delivery-methods';

import { DeferredCryptoSelectorModal as CryptoSelectorModal } from './checkout/components/DeferredCryptoSelectorModal';
import {
  CHECKOUT_FUNNEL_EVENTS,
  buildCheckoutFunnelProperties,
  getCheckoutPaymentIntent,
  resolveFinalizedCheckoutPaymentMethod,
} from '@baci/shared/contracts';
import {
  AlertCircle,
  Building2,
  ChevronRight,
  CreditCard,
  Loader2,
  ShieldCheck,
  Check,
  Copy,
  Clock,
  User,
  X,
} from 'lucide-react';
import { CheckoutStepSection } from './checkout/components/CheckoutStepSection';
import { DeliveryAddressFields, type SavedCheckoutAddress as SavedAddress } from './checkout/components/DeliveryAddressFields';
import { DeliveryOptions } from './checkout/components/DeliveryOptions';
import { isCheckoutDeliveryAddressReady } from './checkout/is-checkout-delivery-address-ready';
import {
  checkoutShippingQuoteDeliveryPreference,
  shouldDiscoverCheckoutPickupQuotes,
  shouldFetchCheckoutShippingQuotes,
} from './checkout/should-fetch-checkout-shipping-quotes';
import {
  DiscountCodeInput,
  type DiscountResult,
} from '@/components/storefront/checkout/discount-code-input';
import { MobileOrderSummary } from '../components/MobileCheckoutComponents';
import { useRouter, useSearchParams } from 'next/navigation';
import type React from 'react';
import { resolveMerchantDeliveryMethod } from './checkout/resolve-merchant-delivery-method';
import { buildCheckoutBillingAddress } from './checkout/build-checkout-billing-address';
import { useCheckoutFormState } from './checkout/hooks/use-checkout-form-state';
import {
  useJuicywayPayment,
  type JuicywayPendingOrder,
} from './checkout/hooks/use-juicyway-payment';
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
  DvaData,
  PaymentMethod,
  PendingCryptoOrder,
  PaymentTab,
  ResumedOrder,
} from './checkout/types';
import { mapApiOrderToResumedOrder } from './checkout/map-api-order-to-resumed-order';
import {
  loadShippingStates,
  loadWalletBalance,
  requestDvaInitialization,
  type DvaBillingAddress,
} from './checkout/checkout-page-data-loaders';
import {
  usePersistedState,
} from '@/hooks/use-persisted-state';
import { useAuthSafe } from '@/contexts/auth-context';
import { DeferredCheckoutAuthModal as CheckoutAuthModal } from './checkout/components/DeferredCheckoutAuthModal';
import {
  type PlaceDetails,
} from '@/components/address-autocomplete';
import { openCredPalCheckout } from '@/lib/credpal';
import { openCreditDirectCheckout } from '@/lib/credit-direct-client';
import { asRoute } from '@/lib/routes';
import { getCountryByCode } from '@/lib/countries';
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
  sanitizeCartItems,
} from '@/lib/checkout/cart-entitlement-sanitizer';
import {
  isBankTransferCheckoutAvailable,
  isKorapayCheckoutAvailable,
  isPaystackCheckoutAvailable,
} from '@/lib/checkout/payment-gateway-availability';
import { isNgnChargeCurrency } from './checkout/components/payment-step-availability';
import { ContactStep } from './checkout/components/ContactStep';
import {
  buildPendingCheckoutFingerprint,
  CHECKOUT_PENDING_ORDER_STORAGE_KEY,
  normalizeOrderPaymentMethod,
  resolvePendingCheckoutOrder,
  type PendingCheckoutOrderSnapshot,
} from './checkout/pending-checkout-order';
import {
  submitRedvaultPreparedOrder,
  type RedvaultPreparedOrder,
  type RedvaultStatus,
} from './checkout/handlers/redvault-prepared-order-submit';
import { resolveRedvaultSubmitFence } from './checkout/handlers/redvault-submit-fence';
import {
  clearCheckoutIdempotencyKey,
  getCheckoutIdempotencyKey,
} from './checkout/checkout-idempotency';
import { captureCheckoutPaymentCompleted } from './checkout/capture-checkout-payment-completed';
import { captureCheckoutPaymentFailed } from './checkout/capture-checkout-payment-failed';
import { captureCheckoutPaymentStarted } from './checkout/capture-checkout-payment-started';
import { captureCreditDirectClientCompletion } from './checkout/credit-direct-client-completion';
import { writeCreditDirectPopupMarker } from './checkout/credit-direct-popup-return';
import { buildCreditDirectVerificationPath } from './checkout/handlers/build-credit-direct-verification-path';
import { executeResumedDirectPayment } from './checkout/handlers/direct-payment';
import { persistCreditDirectPopupReference } from './checkout/persist-credit-direct-popup-reference';
import { getCheckoutOrderErrorMessage } from './checkout/checkout-order-error-message';
import { captureCheckoutFunnelEventOnce } from '@/lib/posthog/capture-checkout-funnel-event';
import { captureClientEvent } from '@/lib/posthog/capture-client-event';
import { selectRejectedVoucherLines } from './checkout/select-rejected-voucher-lines';
import { PaymentStep } from './checkout/components/PaymentStep';
import type { RedvaultQuoteSummary } from './checkout/components/redvault/RedvaultPaymentOption';
import {
  initializeRedvaultPayment,
  parseRedvaultOrderQuote,
} from './checkout/redvault-payment-response';
import { getRedvaultCompatibleCheckoutValues } from './checkout/redvault-compatible-checkout-values';
import {
  invalidatePendingQuoteRequests,
  loadCheckoutShippingQuotes,
} from './checkout/hooks/checkout-shipping-quote-loader';
import { useRedvaultPaymentAvailability } from './checkout/hooks/use-redvault-payment-availability';
import {
  calculateDeliveryCost,
  KLUMP_WALLET_CREDIT_UNAVAILABLE_TOAST,
  createSelectDeliveryMethod,
  getAirDeliveryQuotes,
  getDoorDeliveryQuotes,
  getForwardableSelectedQuoteId,
  getMerchantRateId,
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
import {
  resolveCheckoutStartValues,
  useResumedCheckoutStartFunnel,
} from './checkout/hooks/use-resumed-checkout-start-funnel';
import { readCheckoutAttemptGeneration, rotateCheckoutAttemptGeneration } from './checkout/checkout-attempt-generation';
import { DeferredWalletFundedTransferModal as WalletFundedTransferModal } from './checkout/components/DeferredWalletFundedTransferModal';
import { DeferredWalletTransferConsentDialog as WalletTransferConsentDialog } from './checkout/components/DeferredWalletTransferConsentDialog';
import {
  DesktopOrderSummary,
  type CheckoutItem,
} from './checkout/components/DesktopOrderSummary';


interface ShippingLocation {
  city: string;
  state: string;
}

interface InferredCheckoutAddressLocation {
  city: string;
  state: string;
}

const MANUAL_ADDRESS_LOCATION_DEBOUNCE_MS = 500;

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

// Module-scope helper: probes DVA settlement server-side so "Confirm
// Transfer Sent" only records a conversion for a detected transfer.
// Prefers the token-scoped order status: the settlement webhook marks the
// ORDER paid after matching the transfer to the dedicated account, while
// the DVA reference is a locally generated BAC-* value that was never
// registered as a Paystack transaction (probing /transaction/verify with it
// can only error for real DVA transfers).
export const CheckoutPage: React.FC = () => {
  const { cart, clearCart, isHydrated, removeFromCart } = useCart();
  const merchantContext = useMerchantSafe();
  const merchant = merchantContext?.merchant;
  const redvaultAvailability = useRedvaultPaymentAvailability(merchant?.id);

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
    airportType,
    airportRequiresQuote,
    selectedQuoteId: persistedSelectedQuoteId,
    selectedProviderRateId: persistedSelectedProviderRateId,
    newsletterOptIn,
    currentStep: rawCurrentStep,
    completedSteps: rawCompletedSteps,
  } = checkoutForm;

  // Hydration safety: Force default state during server/first render to match server HTML
  const currentStep = isHydrated ? rawCurrentStep : 'contact';
  const completedSteps = isHydrated ? rawCompletedSteps : { contact: false, delivery: false };

  const [focusActiveStep, setFocusActiveStep] = useState(false);

  // Convenient setters that update the persisted form
  const setFirstName = (v: string) => setCheckoutField('firstName', v);
  const setLastName = (v: string) => setCheckoutField('lastName', v);
  const setCustomerEmail = (v: string) => setCheckoutField('customerEmail', v);
  const setCustomerPhone = (v: string) => setCheckoutField('customerPhone', v);
  const setNewAddressState = (v: string) => setCheckoutField('newAddressState', v);
  const setNewAddressCity = (v: string) => setCheckoutField('newAddressCity', v);
  const setCurrentStep = (v: 'contact' | 'delivery' | 'payment') => { setFocusActiveStep(true); setCheckoutField('currentStep', v); };
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
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);

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

  // Dedicated Virtual Account (DVA) state
  const [dvaData, setDvaData] = useState<DvaModalData | null>(null);
  const [isInitializingDva, setIsInitializingDva] = useState(false);
  const [dvaCountdown, setDvaCountdown] = useState(3600); // 1 hour in seconds
  // "Confirm Transfer Sent" lifecycle (server verification, conversion,
  // routing, delayed cart clear) tied to the modal attempt that started
  // it — see useDvaConfirmTransfer.
  const { closeDvaModal, handleDvaConfirmTransfer, isVerifyingDva } =
    useDvaConfirmTransfer({
      checkoutCart,
      clearCart,
      clearCheckoutSession,
      clearPendingCheckoutOrder,
      currencyCode,
      dvaData,
      getHref,
      merchantSlug: merchant?.slug ?? undefined,
      setDvaData,
    });

  // Crypto selection state (before payment is initialized)
  const [showCryptoSelector, setShowCryptoSelector] = useState(false);
  const [selectedCryptoChain, setSelectedCryptoChain] = useState<CryptoChain>('TRX');
  const [selectedCryptoCurrency, setSelectedCryptoCurrency] = useState<CryptoCurrency>('USDT');
  const [pendingCryptoOrder, setPendingCryptoOrder] =
    useState<JuicywayPendingOrder | null>(null);

  // Juicyway deposit lifecycle (initialization, verification polling,
  // completion/failure analytics, cleanup, navigation).
  const {
    cryptoPaymentData,
    setCryptoPaymentData,
    isVerifyingCrypto,
    cryptoVerificationStatus,
    isInitializingCrypto,
    initializeCryptoPayment,
    verifyCryptoPayment,
    dismissCryptoModal,
    cancelCryptoInitialization,
  } = useJuicywayPayment({
    merchantId: merchant?.id,
    pendingCryptoOrder,
    selectedCryptoChain,
    selectedCryptoCurrency,
    setShowCryptoSelector,
    clearCheckoutSession,
    clearPendingCheckoutOrder,
    clearCart,
    routerPush: (url: string) => {
      router.push(asRoute(url));
    },
    getHref,
  });

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
  // Displayed totals share the funnel's stamped derivation (single
  // source in the focused hook module): a resumed render shows the
  // canonical order total, never the subtotal-only variant.
  const { total: effectiveCheckoutCartTotal } = resolveCheckoutStartValues({
    checkoutCartTotal,
    currencyCode,
    hasCheckoutCartItems,
    resumedOrder,
  });

  // Set once an order is created for this attempt: post-creation rerenders
  // (pending-order persist, widget state) must not re-emit checkout_started
  // for the same attempt just because the generation already rotated.
  // Declared before the funnel hook below, which reads it.
  const [checkoutOrderCreated, setCheckoutOrderCreated] = useState(false);
  // Session-persisted checkout attempt: rotates after every created order so
  // a repeat purchase of the same cart emits a fresh start, while a reload
  // mid-attempt keeps the same generation (unlike React useId, which is
  // deterministic per rendered tree and collides after reload).
  // Start instrumentation (including the resumed-order stamped
  // total/currency derivation) lives in the focused hook below so edits
  // here leave this page smaller, not larger.
  useResumedCheckoutStartFunnel({
    attemptId: `gen-${readCheckoutAttemptGeneration()}`,
    checkoutCartTotal,
    currencyCode,
    displayItems,
    effectiveItemSubtotal,
    hasCheckoutCartItems,
    isHydrated: isHydrated && !checkoutOrderCreated,
    merchantId: merchant?.id,
    resumedOrder,
  });

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
    onOrderPaid: ({ checkoutFingerprint, currency, intentId, orderId, orderNumber, total, trackingToken }) => {
      // The intent reached server-confirmed `completed`: record the paid
      // conversion before redirecting, or the funnel stalls at the start
      // stage for every auto-debited transfer.
      captureCheckoutPaymentCompleted({
        currency,
        orderId,
        // Preserve the omit-when-empty contract: the compactor drops
        // undefined but keeps '', so only forward a real order number.
        ...(orderNumber ? { orderNumber } : {}),
        paymentMethod,
        reference: intentId,
        total,
      });
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


  // Prefer the persisted fee on resume (deep-link URLs omit giftWrappingCost).
  const giftWrappingCost =
    resumedOrder?.gift_wrapping_fee ??
    (Number(searchParams.get('giftWrappingCost')) || 0);

  // Saved Addresses (Future integration: Fetch from API)
  const [addresses, _setAddresses] = useState<SavedAddress[]>([]); // Empty for now, forcing new address


  const [selectedAddressId, setSelectedAddressId] = useState<number>(0);
  const [isNewAddressMode, setIsNewAddressMode] = useState(true);
  const setDeliveryMethod = (value: DeliveryMethod) => setCheckoutField('deliveryMethod', value);
  const setAirportType = (value: 'delivery' | 'pickup') =>
    setCheckoutField('airportType', value);

  // Shipping State
  const [shippingStates, setShippingStates] = useState<string[]>([]);
  const [shippingCities, setShippingCities] = useState<string[]>([]);
  const [isLoadingLocations, setIsLoadingLocations] = useState(false);
  const [shippingQuotes, setShippingQuotes] = useState<ShippingQuote[]>([]);
  const [isLoadingQuotes, setIsLoadingQuotes] = useState(false);
  const selectedQuoteId = persistedSelectedQuoteId || '';
  const selectedProviderRateId = persistedSelectedProviderRateId || '';
  const setSelectedQuoteId = (id: string) => {
    setCheckoutField('selectedQuoteId', id);
    const matched = shippingQuotes.find(
      (quote) => String(quote.id) === String(id),
    );
    setCheckoutField(
      'selectedProviderRateId',
      matched?.providerRateId?.trim() || '',
    );
  };
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
  const resetQuotesForAddressChange = (options?: {
    preserveDeliveryMethod?: boolean;
  }) => {
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
      preserveDeliveryMethod: options?.preserveDeliveryMethod,
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
    if (deliveryMethod === 'airport') return isAirportDeliveryReady(airportRequiresQuote, selectedQuoteMatchesDeliveryMethod);
    // Pickup is valid as long as the current state is eligible.
    return true;
  })();
  const isDeliveryValid = isHydrated ? rawIsDeliveryValid : false;
  useAirportQuoteRecovery(
    isHydrated && deliveryMethod === 'airport' && airportRequiresQuote && !selectedQuoteMatchesDeliveryMethod,
    currentStep,
    () => setCheckoutFields({ currentStep: 'delivery', completedSteps: { ...completedSteps, delivery: false } }),
  );

  // Note: newAddressState, newAddressCity, newAddressStreet are now part of checkoutForm (persisted)


  // Payment State (declared before the resumed-order effect below, which
  // pre-selects the tab/method for BNPL deep links — React Compiler requires
  // declaration before first access)
  const [paymentTab, setPaymentTab] = useState<PaymentTab>('full');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('');
  const [redvaultSummary, setRedvaultSummary] =
    useState<RedvaultQuoteSummary | null>(null);
  const [redvaultStatus, setRedvaultStatus] =
    useState<RedvaultStatus>('idle');
  const [redvaultOrderReady, setRedvaultOrderReady] =
    useState<RedvaultPreparedOrder | null>(null);
  const selectPaymentMethod = (nextMethod: PaymentMethod) => {
    if (isOrderInFlightRef.current || redvaultStatus === 'pending' || redvaultStatus === 'held') return;
    if (
      nextMethod !== paymentMethod &&
      (nextMethod === 'uba_redvault' || paymentMethod === 'uba_redvault')
    ) {
      // Retain a stored REDVAULT fence: after an indeterminate init the
      // order may be persisted and capturing, so only the submit-time
      // resolver (which validates server state and blocks a second order
      // while unresolved) may clear it — never the method switch itself.
      if (pendingCheckoutOrder?.paymentMethod !== 'uba_redvault') {
        clearPendingCheckoutOrder();
      }
      setRedvaultSummary(null);
      setRedvaultStatus('idle');
      setRedvaultOrderReady(null);
    }
    setPaymentMethod(nextMethod);
  };

  useLoadResumedOrder({
    resumeOrderId, resumeMerchantSlug, resumeTrackingToken, resumeLookupEmail,
    preferredGateway, setIsLoadingResumedOrder, setResumedOrder, setCheckoutFields,
    setPaymentTab, setPaymentMethod: selectPaymentMethod, setResumeOrderError,
  });

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
            preferredSelectedQuoteId: selectedQuoteId || undefined,
            preferredProviderRateId: selectedProviderRateId || undefined,
            requestSequence: quoteRequestSequence,
            setResolvedQuoteRequestKey,
            setIsLoadingQuotes,
            setSelectedQuoteId,
            setSelectedProviderRateId: (providerRateId: string) =>
              setCheckoutField('selectedProviderRateId', providerRateId),
            setShippingQuotes,
            onPreferredQuoteMissing: () => setCurrentStep('delivery'),
            requirePreferredQuoteMatch: currentStep === 'payment',
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
    if (deliveryMethod === 'door' || deliveryMethod === 'pickup_station' || deliveryMethod === 'airport') {
      if (!merchant?.id) {
        resetQuotesForAddressChange();
        return;
      }

      if (isNewAddressMode) {
        const hasCityState = Boolean(
          newAddressCity.trim() && newAddressState.trim(),
        );
        if (
          shouldFetchCheckoutShippingQuotes({
            deliveryMethod,
            isStreetReady: isNewDeliveryAddressReady,
            hasCityState,
          }) ||
          shouldDiscoverCheckoutPickupQuotes({
            isStreetReady: isNewDeliveryAddressReady,
            hasCityState,
          })
        ) {
          fetchShippingQuotes(
            newAddressStreet,
            newAddressState,
            newAddressCity,
            customerPhone,
            firstName,
            lastName,
            customerEmail,
            checkoutShippingQuoteDeliveryPreference({
              deliveryMethod,
              isStreetReady: isNewDeliveryAddressReady,
            }),
            false,
          );
        } else {
          // City/state alone can expose airport/store pickup; clearing unavailable
          // door quotes must not force those methods back to door.
          resetQuotesForAddressChange({
            // Inside this quote effect, method is door/pickup_station/airport.
            preserveDeliveryMethod:
              deliveryMethod === 'airport' ||
              deliveryMethod === 'pickup_station',
          });
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
  // Wallet credit calculation (2025: can't redeem more than order total).
  // The customer wallet is an NGN-denominated ledger, so redemption is only
  // offered on NGN orders — mirrors the server-side guard in /api/orders.
  const walletCurrencySupported = currencyCode === 'NGN';
  const checkoutValues = getRedvaultCompatibleCheckoutValues({
    baseTotal:
      effectiveCheckoutCartTotal +
      deliveryCost +
      giftWrappingCost +
      (orderTotals?.taxAmount ?? 0),
    discountAmount,
    discountCode: appliedDiscount?.code,
    paymentMethod,
    payWithWallet,
    walletBalance,
    walletCurrencySupported,
  });
  const total = checkoutValues.total;
  const walletAmountUsed = checkoutValues.walletAmountUsed;
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

  // Thin caller: the resumed BNPL flow lives in the direct-payment
  // handler (Boy Scout extraction); this just binds component state.
  const executeDirectPayment = async () => {
    await executeResumedDirectPayment({
      resumedOrder,
      preferredGateway,
      merchantSlug: merchant?.slug,
      merchantChargeCurrency: currencyCode,
      resumeTrackingToken,
      resumeMerchantSlug,
      setIsProcessing,
      clearCheckoutSession,
      routerPush: (url: string) => {
        router.push(asRoute(url));
      },
      getHref,
    });
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
    if (isOrderInFlightRef.current || redvaultStatus === 'pending' || redvaultStatus === 'held') {
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
      ((deliveryMethod === 'door' || deliveryMethod === 'pickup_station') && !selectedQuoteId) ||
      (deliveryMethod === 'airport' && !isAirportDeliveryReady(airportRequiresQuote, selectedQuoteMatchesDeliveryMethod))
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

    if (paymentMethod === 'uba_redvault' && !redvaultAvailability.available) {
      toast({
        title: 'Payment Unavailable',
        description: 'Pay with UBA is not available right now. Please choose a different payment method.',
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
    // persists a silent zero-shipping order. Treat empty string as no
    // quote too — the state hook initializes selectedQuoteId to `''`.
    if (
      ((deliveryMethod === 'door' || deliveryMethod === 'pickup_station') && !selectedQuoteId) ||
      (deliveryMethod === 'airport' && !isAirportDeliveryReady(airportRequiresQuote, selectedQuoteMatchesDeliveryMethod))
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
    const checkoutFingerprint = (paymentMethod === 'uba_redvault' ? 'uba_redvault:' : '') + buildPendingCheckoutFingerprint({
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
      useWalletCredit: checkoutValues.useWalletCredit,
      walletAmountUsed,
      discountCode: checkoutValues.discountCode,
      giftWrappingCost,
    });

    let createdOrderId: string | undefined;
    let createdOrderNumber = '';
    let orderChargeCurrency = currencyCode;
    // Set only when a provider flow actually opens. Pre-payment browser
    // failures (blocked session storage, invoice/POD branches that never
    // start a payment) must not be attributed as payment_failed.
    let paymentStarted = false;
    // Initialized provider reference for this submit, mirrored wherever a
    // start is stamped so post-start failures reconcile to the same attempt.
    let initializedReference: string | undefined;
    // A REDVAULT order prepared by an earlier click initializes through
    // the extracted submit handler (stale-fingerprint cancel, guest
    // signup/attach, initialization, and redirect/hold handling).
    if (
      await submitRedvaultPreparedOrder({
        paymentMethod,
        redvaultOrderReady,
        checkoutFingerprint,
        waitForResolvedStorefrontCustomerAuth,
        isOrderInFlightRef,
        setIsProcessing,
        setRedvaultStatus,
        setRedvaultOrderReady,
        clearPendingCheckoutOrder,
        createAccount,
        user,
        accountPassword,
        firstName,
        lastName,
        merchantId: merchant?.id ?? '',
        // The prepared order initializes through the extracted handler:
        // record its start here so the funnel does not jump from
        // order_created straight to completion/failure.
        onPaymentStarted: ({ orderId, currency, reference, total, orderNumber }) => {
          paymentStarted = true;
          initializedReference = reference;
          captureCheckoutPaymentStarted({
            currency,
            orderId,
            orderNumber,
            paymentMethod: 'uba_redvault',
            reference,
            total,
          });
        },
      })
    ) {
      return;
    }

    try {
      let order: {
        id: string;
        order_number?: string;
        payment_status?: string;
        total?: number;
        tracking_token?: string;
        /** Stamped orders.currency (returned by /api/orders and /api/orders/reuse). */
        currency?: string | null;
        /**
         * Server-authoritative method: the API rewrites this to
         * wallet/store_credit/savings/quiz_voucher when credits or prizes
         * cover the order, so it differs from the UI selection then.
         */
        payment_method?: string | null;
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

      // The REDVAULT pending-order fence verdict (paid routing, blocking
      // cancels, live replay) lives in the extracted submit handler.
      if (
        await resolveRedvaultSubmitFence({
          fence: reusablePendingOrder,
          checkoutFingerprint,
          customerEmail,
          merchantId: merchant.id,
          firstName,
          lastName,
          customerPhone,
          finalAddress,
          finalCity,
          finalState,
          merchantCountry,
          waitForResolvedStorefrontCustomerAuth,
          isOrderInFlightRef,
          setIsProcessing,
          setRedvaultStatus,
          clearPendingCheckoutOrder,
          clearCheckoutSession,
          clearCart,
          pushSuccessRoute: (path) => router.push(asRoute(getHref(path))),
        })
      ) {
        return;
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
          body: JSON.stringify(buildCheckoutOrderRequest({
            merchantId: merchant.id,
            items: orderItems,
            paymentMethod: normalizedPaymentMethod,
            acceptsMarketing: newsletterOptIn,
            customer: { name: `${firstName} ${lastName}`.trim(), email: customerEmail, phone: customerPhone, userId: user?.id },
            money: { subtotal: checkoutCartTotal, shipping: deliveryCost, tax: orderTotals?.taxAmount ?? 0, giftWrapping: giftWrappingCost, discountAmount: checkoutValues.discountAmount, discountCode: checkoutValues.discountCode, useWalletCredit: checkoutValues.useWalletCredit, walletAmount: walletAmountUsed },
            delivery: { method: deliveryMethod, airportType, quoteMatchesMethod: selectedQuoteMatchesDeliveryMethod, selectedQuoteId, merchantRateId, provider: shippingProvider, address: shippingAddressData },
          })),
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
        if (paymentMethod === 'uba_redvault') {
          const summary = parseRedvaultOrderQuote(orderData);
          setRedvaultSummary(summary);
          amountDueToGateway = summary.payableKobo / 100;
        }
        walletResult = orderData.wallet;
        if (paymentMethod !== 'uba_redvault') {
          amountDueToGateway = orderData.amountDueToGateway ?? total;
        }
      }

      createdOrderId = order.id;
      createdOrderNumber =
        order.order_number || order.id.slice(0, 8).toUpperCase();
      // A created order completes this checkout attempt: rotate the session
      // generation so a repeat purchase emits a fresh checkout_started, and
      // suppress further starts for this attempt (post-creation rerenders
      // must not re-emit just because the generation already rotated).
      rotateCheckoutAttemptGeneration();
      setCheckoutOrderCreated(true);
      orderChargeCurrency =
        typeof order.currency === 'string' && order.currency.trim()
          ? order.currency.trim().toUpperCase()
          : currencyCode;
      // The server is authoritative only when it actually finalized
      // coverage (see resolveFinalizedCheckoutPaymentMethod): attribute
      // creation to the finalized method so creation and completion share
      // one funnel. Any other server value keeps the UI gateway.
      const serverPaymentMethod =
        typeof order.payment_method === 'string'
          ? order.payment_method
          : undefined;
      const finalizedPaymentMethod = resolveFinalizedCheckoutPaymentMethod(
        serverPaymentMethod,
        paymentMethod
      );
      captureCheckoutFunnelEventOnce(
        CHECKOUT_FUNNEL_EVENTS.orderCreated,
        order.id,
        buildCheckoutFunnelProperties({
          channel: 'web',
          currency: orderChargeCurrency,
          itemCount: orderItems.reduce((count, item) => count + item.quantity, 0),
          orderId: order.id,
          orderNumber: createdOrderNumber,
          paymentIntent: getCheckoutPaymentIntent(finalizedPaymentMethod),
          paymentMethod: finalizedPaymentMethod,
          paymentStatus: order.payment_status || 'unpaid',
          shipping: deliveryCost,
          source: 'web_checkout',
          subtotal: effectiveItemSubtotal,
          tax: orderTotals?.taxAmount ?? 0,
          total: order.total ?? total,
        })
      );

      // The ORDER row's stamped currency is authoritative for payment
      // initialization: a reused/idempotent order keeps its original currency
      // even if the merchant's payout currency changed after it was created,
      // and the initialize API rejects an explicit client/order mismatch.
      // Both order sources return it (/api/orders and /api/orders/reuse);
      // fall back to the merchant-resolved code only if it is ever absent.
      // orderChargeCurrency was already resolved from the created ORDER
      // row above; reuse it (do not redeclare: the assignment above and
      // this block share one scope).
      const billingAddress = buildCheckoutBillingAddress(
        finalAddress,
        finalCity,
        finalState,
        merchantCountry
      );

      // Persist the fence before any early return: the REDVAULT review
      // branch below returns before payment, so a reload mid-review would
      // otherwise lose the snapshot and let a method switch open a second
      // order while this one still reserves inventory.
      const pendingSnapshot: PendingCheckoutOrderSnapshot = {
        orderId: order.id,
        orderNumber: order.order_number,
        trackingToken: order.tracking_token,
        merchantId: merchant.id,
        customerEmail,
        customerPhone,
        checkoutFingerprint,
        paymentMethod: normalizedPaymentMethod,
        amountDueToGateway,
        createdAt: new Date().toISOString(),
      };
      persistPendingCheckoutOrder(pendingSnapshot);
      setPendingCheckoutOrder(pendingSnapshot);

      if (paymentMethod === 'uba_redvault' && !redvaultOrderReady) {
        setRedvaultOrderReady({
          billingAddress,
          customerEmail,
          customerName: `${firstName} ${lastName}`.trim(),
          customerPhone,
          currency: orderChargeCurrency,
          orderId: order.id,
          checkoutFingerprint,
          trackingToken: order.tracking_token,
          // Stamped for the prepared start: the full revenue value and
          // number, matching the fresh-path start event — never the
          // residual gateway due.
          total: order.total ?? total,
          orderNumber: createdOrderNumber,
        });
        setIsProcessing(false);
        isOrderInFlightRef.current = false;
        return;
      }

      // 1b. Create account if requested (Awaited to ensure session is set before moving to next page)
      if (
        paymentMethod !== 'uba_redvault' &&
        createAccount &&
        !user &&
        accountPassword.length >= 6
      ) {
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

      // Marks the per-attempt started flag and delegates the event shape
      // to the focused helper: initialization failures before a provider
      // flow opens keep the error UI but must not emit an unmatched start.
      const capturePaymentStarted = (reference?: string) => {
        paymentStarted = true;
        captureCheckoutPaymentStarted({
          currency: orderChargeCurrency,
          orderId: order.id,
          orderNumber: createdOrderNumber,
          paymentMethod,
          reference,
          // Revenue is the canonical order total, not the residual due
          // at the provider after wallet/savings credit — matching
          // order_created above and the eventual completion.
          // paymentAmount stays on the provider initialization, which
          // charges only the residual.
          total: order.total ?? total,
        });
      };

      // Update local wallet balance if redemption occurred
      if (walletResult?.amountUsed) {
        setWalletBalance(walletResult.newBalance);
      }

      // 2. Handle payment based on method
      // Special case: If wallet fully covers the order, no payment gateway needed
      // Order API already marks it as paid, just redirect to success
      if (paymentMethod !== 'uba_redvault' && paymentAmount <= 0) {
        // Nothing is due at a gateway, but a conversion requires the
        // authoritative paid status: zero due without server-finalized
        // coverage (e.g. a 100% discount, where the API leaves the order
        // unpaid) must not fabricate a paid payment_completed — no
        // provider or server payment confirmation occurred.
        if (order.payment_status === 'paid') {
          // Wallet/server-side credit covered the full amount and the order
          // API already marked the order paid: record the conversion before
          // leaving. Attribute the server-returned method
          // (wallet/store_credit/savings/quiz_voucher after full coverage),
          // not the UI selection.
          const zeroDuePaymentMethod = order.payment_method || paymentMethod;
          captureCheckoutPaymentCompleted({
            currency: orderChargeCurrency,
            orderId: order.id,
            orderNumber: createdOrderNumber,
            paymentMethod: zeroDuePaymentMethod,
            total: order.total ?? total,
          });
        } else if (paymentMethod === 'invoice') {
          // Zero due without paid coverage (e.g. a 100% discount): the
          // server still generates and emails a proforma, but the
          // generation is confirmed asynchronously in after() — the
          // success page captures invoice_generated only once the
          // lookup carries the terminal delivery flag, so recording it
          // here would book a conversion for generation that may fail.
        }
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
                currency: orderChargeCurrency,
                merchantId: merchant.id,
                merchantSlug: merchant.slug ?? undefined,
                orderId: order.id,
                orderNumber: createdOrderNumber,
                // Canonical row total for the completion revenue (the
                // intent target is the post-savings residual).
                orderTotal: order.total ?? total,
                trackingToken: order.tracking_token,
              })
            : ('fallback' as const);

        if (
          walletFundedOutcome !== 'fallback' &&
          walletFundedOutcome !== 'uncertain'
        ) {
          // Stamp the funding-intent ID: a retried order creates a second
          // intent, and both attempts' lifecycle events must stay
          // distinguishable (the completion stamps it likewise).
          capturePaymentStarted(walletFundedOutcome.intentId);
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

        await handleBankTransfer(
          order,
          paymentAmount,
          billingAddress,
          capturePaymentStarted,
          checkoutFingerprint,
          () => paymentStarted
        );
        return;
      }

      if (paymentMethod === 'uba_redvault') {
        setRedvaultStatus('pending');
        const paymentResult = await initializeRedvaultPayment({
          merchantId: merchant.id,
          orderId: order.id,
          currency: orderChargeCurrency,
          customerEmail,
          customerName: `${firstName} ${lastName}`.trim(),
          customerPhone,
          trackingToken: order.tracking_token,
          billingAddress,
        }).catch((error: unknown) => {
          setRedvaultStatus('error');
          throw error;
        });
        if (paymentResult.kind === 'pending_reconciliation') {
          setIsProcessing(false);
          isOrderInFlightRef.current = false;
          return;
        }
        if (paymentResult.kind === 'captured_held') {
          setRedvaultStatus('held');
          setIsProcessing(false);
          isOrderInFlightRef.current = false;
          return;
        }
        // The REDVAULT attempt opens now: record the start with the init
        // reference so the funnel does not jump from order_created
        // straight to completion/failure.
        capturePaymentStarted(paymentResult.reference);
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
                  signup_type: 'customer',
                },
              },
            });
          } catch (authError) {
            console.error('Silent signup background error:', authError);
          }
        }
        window.location.assign(paymentResult.authorizationUrl);
        return;
      }

      if (paymentMethod === 'paystack' || paymentMethod === 'korapay' || paymentMethod === 'juicyway' || paymentMethod === 'klump') {
        // For Juicyway crypto payments, show the selector first
        if (paymentMethod === 'juicyway') {
          setPendingCryptoOrder({
            orderId: order.id,
            trackingToken: order.tracking_token,
            amount: paymentAmount,
            // Canonical row total first (same rule as order_created).
            total: order.total ?? total,
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
          initializedReference = paymentResult.reference;
          capturePaymentStarted(initializedReference);
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
          // Klump navigates to the BNPL launcher, which records the start
          // from the widget's onOpen: firing here would strand an unmatched
          // start when the launcher lookup, SDK load, or widget fails
          // before Klump opens.
          if (paymentMethod !== 'klump') {
            initializedReference = paymentResult.reference;
            capturePaymentStarted(initializedReference);
          }
          window.location.assign(paymentResult.authorization_url);
          return;
        } else if (paymentResult.success && paymentResult.checkout_url) {
          // Juicyway uses checkout_url
          initializedReference = paymentResult.reference;
          capturePaymentStarted(initializedReference);
          window.location.assign(paymentResult.checkout_url);
          return;
        } else {
          raiseCheckoutError('Payment initialization failed: No auth URL returned');
        }
      } else if (paymentMethod === 'credit_direct') {
        // Credit Direct BNPL - Client-side popup checkout
        // Note: BNPL typically uses full total (wallet credits may not apply)
        // The opener swallows init failures into onError, so the start fires
        // from onPopup: only a real popup opening proves the flow started.
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
            // The opener swallows SDK initialization failures into onError
            // without opening a popup: only attribute a payment failure
            // when onPopup already proved the provider flow started.
            if (paymentStarted) {
              captureCheckoutPaymentFailed({
                currency: orderChargeCurrency,
                orderId: order.id,
                orderNumber: createdOrderNumber,
                paymentMethod,
                reason: 'credit_direct_error',
                reference: initializedReference,
                // Canonical order total (same rule as the start/creation
                // events): paymentAmount is only the residual provider
                // charge after wallet/savings credit.
                total: order.total ?? total,
              });
            }
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
            initializedReference = checkoutTransactionId || sessionId;
            capturePaymentStarted(initializedReference);
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

        // Open CredPal popup. The opener throws on script/SDK init failure,
        // so the start fires from the widget's load confirmation instead of
        // before initialization: a failed load records only the failure.
        await openCredPalCheckout({
          key: credpalKey,
          amount: paymentAmount,
          product: cart.map(item => item.name).join(', '),
          customerEmail,
          customerName: `${firstName} ${lastName}`.trim(),
          customerPhone,
          onLoad: () => {
            capturePaymentStarted();
          },
          onSuccess: async (data) => {
            console.log('CredPal success:', data);
            // Accepted-but-pending applications are not paid conversions, but
            // the shopper must still reach the success experience: cleanup and
            // navigation run for both outcomes, capture only for success.
            if (data.status === 'success') {
              // paymentAmount is only the residual sent to CredPal
              // after wallet credits; revenue is the full order total.
              captureCheckoutPaymentCompleted({
                currency: orderChargeCurrency,
                orderId: order.id,
                orderNumber: createdOrderNumber,
                paymentMethod,
                reference: data.order_no,
                total: order.total ?? paymentAmount,
              });
            }
            clearPendingCheckoutOrder();
            await clearCheckoutIdempotencyKey(checkoutFingerprint);
            clearCheckoutSession();
            clearCart();
            const successQuery = new URLSearchParams({
              type: 'credpal',
              orderId: order.id,
              credpalRef: data.order_no,
            });
            if (data.status) {
              // Lets native hosts skip paid attribution for pending results.
              successQuery.set('credpalStatus', data.status);
            }
            if (order.tracking_token) {
              successQuery.set('trackingToken', order.tracking_token);
            }
            router.push(
              asRoute(getHref(`/order-success?${successQuery.toString()}`))
            );
          },
          onError: (error) => {
            console.error('CredPal error:', error);
            // Widget setup failures invoke onError before onLoad: only
            // attribute a payment failure when the widget already proved
            // the provider flow started (same per-attempt gate as Credit
            // Direct). Unopened failures keep the toast + retry below.
            if (paymentStarted) {
              captureCheckoutPaymentFailed({
                currency: orderChargeCurrency,
                orderId: order.id,
                orderNumber: createdOrderNumber,
                paymentMethod,
                reason: 'credpal_error',
                // Canonical order total, matching the start event —
                // paymentAmount is only the residual provider charge.
                total: order.total ?? total,
              });
            }
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
        // invoice_generated is captured on the success page only after
        // the server confirms terminal artifact delivery (see
        // useInvoiceGeneratedCapture) — never optimistically here.
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
        // Pay for Me handoff: nothing is delivered to the payer contact —
        // the requester's email carries the transfer details and the
        // success page hands them the shareable payment link to forward.
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
      if (createdOrderId && paymentStarted) {
        captureCheckoutPaymentFailed({
          currency: orderChargeCurrency,
          orderId: createdOrderId,
          orderNumber: createdOrderNumber,
          paymentMethod,
          reason: error instanceof Error ? error.name : 'checkout_error',
          reference: initializedReference,
        });
      }
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
    order: {
      id: string;
      currency?: string | null;
      order_number?: string | null;
      tracking_token?: string | null;
      total?: number | null;
    },
    paymentAmount: number,
    billingAddress: DvaBillingAddress,
    onDvaReady?: (reference?: string) => void,
    checkoutFingerprint?: string,
    // Proves the provider flow opened (same per-attempt flag as the BNPL
    // gates): initialization failures before a DVA is ready keep the
    // error UI but must not emit an unmatched payment_failed.
    didPaymentStart?: () => boolean
  ) => {
    if (!merchant) {
      isOrderInFlightRef.current = false;
      return;
    }

    setIsInitializingDva(true);
    // Stamped order currency is authoritative; fall back to the
    // merchant-resolved code only if the row value is ever absent. Stored
    // on the modal state so completion labels the same currency even if
    // the merchant changes payout currency before the shopper confirms.
    const stampedDvaCurrency =
      typeof order.currency === 'string' && order.currency.trim()
        ? order.currency.trim().toUpperCase()
        : currencyCode;
    await requestDvaInitialization({
      merchantId: merchant.id,
      orderId: order.id,
      customerEmail,
      customerName: `${firstName} ${lastName}`.trim(),
      customerPhone,
      billingAddress,
      orderCurrency: stampedDvaCurrency,
    })
      .then((result) => {
        setDvaData({
          ...result.dva,
          amount: paymentAmount,
          // Canonical row total first (same rule as order_created):
          // the client-computed total can lag the server row.
          total: order.total ?? total,
          reference: result.reference,
          orderId: order.id,
          orderNumber: order.order_number ?? undefined,
          trackingToken: order.tracking_token,
          checkoutFingerprint,
          orderCurrency: stampedDvaCurrency,
        });
        setDvaCountdown(3600);
        onDvaReady?.(result.reference);
        isOrderInFlightRef.current = false;
      })
      .catch((error: unknown) => {
        console.error('DVA initialization error:', error);
        if (didPaymentStart?.()) {
          captureCheckoutPaymentFailed({
            currency:
              typeof order.currency === 'string' && order.currency.trim()
                ? order.currency.trim().toUpperCase()
                : currencyCode,
            orderId: order.id,
            paymentMethod: 'bank_transfer',
            reason: 'bank_transfer_error',
            // Canonical row total first (same rule as order_created):
            // paymentAmount is only the residual DVA charge.
            total: order.total ?? total,
          });
        }
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
            <span className="max-sm:hidden sm:inline">Return to Cart</span>
          </button>

          <div className="flex flex-col items-center">
            <div className="font-bold text-gray-900 tracking-tight flex items-center gap-2">
              <ShieldCheck className="size-4 text-green-600" />
              <span>Secure Checkout</span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="max-sm:hidden sm:flex items-center gap-1.5 px-3 py-1 bg-green-50 text-green-700 text-xs font-medium rounded-full border border-green-100">
              <div className="size-1.5 rounded-full bg-green-500 animate-pulse" />
              Encrypted
            </div>
          </div>
        </div>
      </div>
      {isAuthModalOpen && <CheckoutAuthModal
        isOpen={isAuthModalOpen}
        onOpenChange={setIsAuthModalOpen}
        onSuccess={() => setIsAuthModalOpen(false)}
      />}

      {/* Crypto Selector Modal */}
      {showCryptoSelector && (
        <CryptoSelectorModal
          selectedCryptoCurrency={selectedCryptoCurrency}
          selectedCryptoChain={selectedCryptoChain}
          supportedChains={cryptoChainSupport[selectedCryptoCurrency]}
          isInitializingCrypto={isInitializingCrypto}
          onCurrencyChange={(currency) => { cancelCryptoInitialization(); handleCryptoCurrencyChange(currency); }}
          onChainChange={(chain) => { cancelCryptoInitialization(); setSelectedCryptoChain(chain); }}
          onInitialize={initializeCryptoPayment}
          onClose={() => {
            cancelCryptoInitialization();
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
                  dismissCryptoModal();
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
                      dismissCryptoModal();
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
                onClick={closeDvaModal}
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
                  onClick={handleDvaConfirmTransfer}
                  disabled={isVerifyingDva}
                  className="w-full py-4 bg-store-primary text-white font-bold rounded-xl hover:bg-store-primary/90 transition-colors shadow-lg shadow-store-primary/20 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isVerifyingDva ? 'Verifying transfer…' : 'Confirm Transfer Sent'}
                </button>
                <button
                  type="button"
                  onClick={closeDvaModal}
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
        {paymentMethod !== 'uba_redvault' && <MobileOrderSummary
          cart={mobileSummaryCart}
          cartTotal={effectiveCheckoutCartTotal}
          deliveryCost={resumedOrder ? resumedOrder.shipping_cost : deliveryCost}
          taxAmount={resumedOrder?.tax_amount ?? orderTotals?.taxAmount ?? 0}
          discountAmount={resumedOrder?.discount_amount ?? checkoutValues.discountAmount}
          deliveryMethod={resumedOrder ? null : deliveryMethod}
          giftWrappingCost={giftWrappingCost}
          walletBalance={walletBalance}
          payWithWallet={checkoutValues.payWithWallet}
          walletAmountUsed={walletAmountUsed}
          remainingAmount={resumedOrder?.total ?? remainingAmount}
        />}

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

            <ContactStep
              focusOnActivate={focusActiveStep}
              active={currentStep === 'contact'}
              completed={completedSteps.contact}
              values={{ firstName, lastName, customerEmail, customerPhone }}
              onChange={setCheckoutField}
              account={{ createAccount, password: accountPassword }}
              onAccountChange={({ createAccount: nextCreateAccount, password }) => {
                setCreateAccount(nextCreateAccount);
                setAccountPassword(password);
              }}
              signedIn={Boolean(user)}
              onOpen={() => setCurrentStep('contact')}
              onComplete={() => { setFocusActiveStep(true); setCheckoutFields({ currentStep: 'delivery', completedSteps: { ...completedSteps, contact: true } }); }}
            />

            <CheckoutStepSection focusOnActivate={focusActiveStep} id="checkout-delivery" title="Delivery Method" number={2}
              active={currentStep === 'delivery'} completed={completedSteps.delivery} disabled={!completedSteps.contact}
              summary={deliveryMethod === 'door' ? `By Road${newAddressCity ? ` · ${newAddressCity}` : ''}` : deliveryMethod === 'pickup_station' ? 'Pickup Station' : deliveryMethod === 'pickup' ? 'Store Pickup' : 'By Air'}
              onOpen={() => setCurrentStep('delivery')}>
              <DeliveryAddressFields signedIn={Boolean(user)} addresses={addresses} isNewAddressMode={isNewAddressMode}
                selectedAddressId={selectedAddressId} newAddressStreet={newAddressStreet} newAddressCity={newAddressCity} newAddressState={newAddressState}
                merchantCountry={merchantCountry} addressReady={isHydrated && isNewDeliveryAddressReady}
                onToggleAddressMode={() => setIsNewAddressMode(!isNewAddressMode)}
                                onSelectAddress={(addr) => {
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
                            onStreetChange={(newVal) => {
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
                            onSelectPlace={(place: PlaceDetails) => {
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

              />
              {canShowDeliveryMethods({ isHydrated, isNewAddressMode, selectedAddressId, city: newAddressCity, state: newAddressState }) && <DeliveryOptions
                tabs={{ deliveryMethod, newAddressState, merchantSlug: merchant?.slug, stationPickupQuote, hasMerchantPickupQuote, onSelect: selectDeliveryMethod }}
                station={{ isLoadingQuotes, stationPickupQuote, stationPickupQuotes, selectedQuoteId, setSelectedQuoteId }}
                airport={{ airportType, requiresProviderQuote: airportRequiresQuote, city: newAddressCity, state: newAddressState,
                  selectedQuoteId, selectedQuoteMatchesDeliveryMethod, airDeliveryQuotes,
                  onSelectAirportType: type => { setAirportType(type); setCheckoutField('airportRequiresQuote', false); setSelectedQuoteId(''); },
                  onSelectQuote: id => { setCheckoutField('airportRequiresQuote', true); setSelectedQuoteId(id); }
                }}
                door={{ isLoadingQuotes, doorDeliveryQuotes, stationPickupQuote, selectedQuoteId, onSelectQuote: setSelectedQuoteId,
                  onSelectStationPickup: quoteId => { setSelectedQuoteId(quoteId); setDeliveryMethod('pickup_station'); },
                  onRefreshRates: () => { if (isNewDeliveryAddressReady) fetchShippingQuotes(newAddressStreet, newAddressState, newAddressCity, customerPhone, firstName, lastName, customerEmail); }
                }}
              />}
              <div className="pt-2">
                <button type="button" disabled={!isDeliveryValid}
                        onClick={() => {
                          captureClientEvent(
                            CHECKOUT_FUNNEL_EVENTS.checkoutStepCompleted,
                            buildCheckoutFunnelProperties({
                              channel: 'web',
                              checkoutStep: 'shipping_info',
                              source: 'web_checkout',
                            })
                          );
                          setCompletedSteps(prev => ({ ...prev, delivery: true }));
                          setCurrentStep('payment');
                        }}

                  className="w-full md:w-auto px-6 py-3 bg-store-primary text-white font-bold rounded-xl hover:bg-store-primary/90 transition-colors flex items-center justify-center gap-2 shadow-lg hover:shadow-store-primary/20 disabled:bg-gray-300 disabled:text-gray-500 disabled:cursor-not-allowed disabled:shadow-none">
                  Continue to Payment <ChevronRight size={18} />
                </button>
              </div>
            </CheckoutStepSection>

            {/* Step 3: Payment Method */}
            <PaymentStep
              focusOnActivate={focusActiveStep}
              currentStep={currentStep}
              completedSteps={completedSteps}
              paymentTab={paymentTab}
              setPaymentTab={setPaymentTab}
              paymentMethod={paymentMethod}
              setPaymentMethod={selectPaymentMethod}
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
              redvaultAvailable={redvaultAvailability.available}
              redvaultStatus={redvaultStatus}
              redvaultSummary={redvaultSummary}
              redvaultOrderReady={Boolean(redvaultOrderReady)}
            />

          </div>

          <DesktopOrderSummary
            displayItems={displayItems}
            formatCurrencyAuto={formatCurrencyAuto}
            effectiveCheckoutCartTotal={effectiveCheckoutCartTotal}
            orderTotals={orderTotals}
            deliveryCost={deliveryCost}
            deliveryMethod={deliveryMethod}
            selectedQuoteId={selectedQuoteId}
            giftWrappingCost={giftWrappingCost}
            paymentMethod={paymentMethod}
            walletCurrencySupported={walletCurrencySupported}
            walletLoading={walletLoading}
            walletBalance={walletBalance}
            hasUser={Boolean(user)}
            currencySymbol={currencySymbol}
            payWithWallet={payWithWallet}
            setPayWithWallet={setPayWithWallet}
            walletAmountUsed={walletAmountUsed}
            remainingAmount={remainingAmount}
            checkoutPayWithWallet={checkoutValues.payWithWallet}
            redvaultSummary={redvaultSummary}
            newsletterOptIn={newsletterOptIn}
            setNewsletterOptIn={setNewsletterOptIn}
            handlePlaceOrder={handlePlaceOrder}
            isProcessing={isProcessing}
            isPayForMeValid={isPayForMeValid}
          />
        </div>
      </div>

    </div >
  );
};
