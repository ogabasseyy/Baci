'use client';
import { useCheckoutAddressInference } from './checkout/hooks/use-checkout-address-inference';
import { useCheckoutDeliveryAddressHandlers } from './checkout/hooks/use-checkout-delivery-address-handlers';
import { useCheckoutDeliveryOptions } from './checkout/hooks/use-checkout-delivery-options';
import { useCheckoutShippingQuotes } from './checkout/hooks/use-checkout-shipping-quotes';
import { useLoadResumedOrder } from './checkout/hooks/use-load-resumed-order';
import { useOrderTotals } from './checkout/hooks/use-order-totals';
import { resolveCheckoutResumeContext } from './checkout/resolve-checkout-resume-context';

import { useAirportQuoteRecovery } from './checkout/hooks/use-airport-quote-recovery';
import {
  useDvaConfirmTransfer,
  type DvaModalData,
} from './checkout/hooks/use-dva-confirm-transfer';

import { DeferredCryptoSelectorModal as CryptoSelectorModal } from './checkout/components/DeferredCryptoSelectorModal';
import {
  CHECKOUT_FUNNEL_EVENTS,
  buildCheckoutFunnelProperties,
  getCheckoutPaymentIntent,
} from '@baci/shared/contracts';
import {
  AlertCircle,
  ChevronRight,
  Loader2,
  ShieldCheck,
  User,
} from 'lucide-react';
import { DvaModal } from './checkout/components/DvaModal';
import { CryptoPaymentModal } from './checkout/components/CryptoPaymentModal';
import { CheckoutDeliveryStep } from './checkout/components/CheckoutDeliveryStep';
import type { SavedCheckoutAddress as SavedAddress } from './checkout/components/DeliveryAddressFields';
import {
  DiscountCodeInput,
  type DiscountResult,
} from '@/components/storefront/checkout/discount-code-input';
import { MobileOrderSummary } from '../components/MobileCheckoutComponents';
import { useRouter, useSearchParams } from 'next/navigation';
import type React from 'react';
import { resolveMerchantDeliveryMethod } from './checkout/resolve-merchant-delivery-method';
import { isAirportDeliveryReady } from './checkout/is-airport-delivery-ready';
import { useCheckoutFormState } from './checkout/hooks/use-checkout-form-state';
import { useCheckoutStepState } from './checkout/hooks/use-checkout-step-state';
import {
  useJuicywayPayment,
  type JuicywayPendingOrder,
} from './checkout/hooks/use-juicyway-payment';
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
} from './checkout/checkout-page-data-loaders';
import {
  usePersistedState,
} from '@/hooks/use-persisted-state';
import { useAuthSafe } from '@/contexts/auth-context';
import { DeferredCheckoutAuthModal as CheckoutAuthModal } from './checkout/components/DeferredCheckoutAuthModal';
import {
  type PlaceDetails,
} from '@/components/address-autocomplete';
import { asRoute } from '@/lib/routes';
import { getSubdivisions } from '@/lib/shipping/merchant-rates/subdivisions';
import { toast } from '@/hooks/use-toast';
import { buildCheckoutOrderItems } from '@/lib/checkout/build-order-items';
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
  CHECKOUT_PENDING_ORDER_STORAGE_KEY,
  type PendingCheckoutOrderSnapshot,
} from './checkout/pending-checkout-order';
import { prepareCheckoutOrderSubmission } from './checkout/prepare-checkout-order-submission';
import type {
  RedvaultPreparedOrder,
  RedvaultStatus,
} from './checkout/handlers/redvault-prepared-order-submit';
import {
  clearCheckoutIdempotencyKey,
  getCheckoutIdempotencyKey,
} from './checkout/checkout-idempotency';
import { captureCheckoutPaymentCompleted } from './checkout/capture-checkout-payment-completed';
import { useCheckoutSubmissionState } from './checkout/hooks/use-checkout-submission-state';
import { captureCheckoutPaymentStarted } from './checkout/capture-checkout-payment-started';
import { executeResumedDirectPayment } from './checkout/handlers/direct-payment';
import { getCheckoutOrderErrorMessage } from './checkout/checkout-order-error-message';
import { submitFreshCheckout } from './checkout/handlers/submit-fresh-checkout';
import { signUpCheckoutCustomer } from './checkout/handlers/sign-up-checkout-customer';
import { captureClientEvent } from '@/lib/posthog/capture-client-event';
import { PaymentStep } from './checkout/components/PaymentStep';
import type { RedvaultQuoteSummary } from './checkout/components/redvault/RedvaultPaymentOption';
import { getRedvaultCompatibleCheckoutValues } from './checkout/redvault-compatible-checkout-values';
import { useRedvaultPaymentAvailability } from './checkout/hooks/use-redvault-payment-availability';
import {
  calculateDeliveryCost,
  KLUMP_WALLET_CREDIT_UNAVAILABLE_TOAST,
  createSelectDeliveryMethod,
  getAirDeliveryQuotes,
  getDoorDeliveryQuotes,
  getStationPickupQuote,
  getStationPickupQuotes,
  inferAddressLocationFromInput,
  isGiglGoFasterQuote,
  isMerchantQuote,
  isStationPickupQuote,
} from './checkout/utils';
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

  const {
    currentStep,
    completedSteps,
    focusActiveStep,
    setCurrentStep,
    setCompletedSteps,
    completeContact,
  } = useCheckoutStepState({
    isHydrated,
    currentStep: rawCurrentStep,
    completedSteps: rawCompletedSteps,
    setField: setCheckoutField,
    setFields: setCheckoutFields,
  });

  // Convenient setters that update the persisted form
  const setFirstName = (v: string) => setCheckoutField('firstName', v);
  const setLastName = (v: string) => setCheckoutField('lastName', v);
  const setCustomerEmail = (v: string) => setCheckoutField('customerEmail', v);
  const setCustomerPhone = (v: string) => setCheckoutField('customerPhone', v);
  const setNewAddressState = (v: string) => setCheckoutField('newAddressState', v);
  const setNewAddressCity = (v: string) => setCheckoutField('newAddressCity', v);
  const { clearInferredLocationDebounce, scheduleInferredLocationUpdate } =
    useCheckoutAddressInference(setCheckoutFields);
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
  const {
    resumeOrderId,
    resumeTrackingToken,
    resumeLookupEmail,
    resumeMerchantSlug,
    preferredGateway,
  } = resolveCheckoutResumeContext({
    searchParams,
    pendingCheckoutOrder,
    merchantId: merchant?.id,
    merchantSlug: merchant?.slug,
  });
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
  const {
    isProcessing, setIsProcessing, isOrderInFlightRef,
    tryBeginSubmission, releaseSubmission, handleSubmissionError,
  } = useCheckoutSubmissionState({ setCurrentStep, setCompletedSteps });
  usePaymentReturnReset(releaseSubmission);

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
  const [isLoadingLocations, setIsLoadingLocations] = useState(false);
  const {
    shippingQuotes,
    isLoadingQuotes,
    selectedQuoteId,
    setSelectedQuoteId,
    resetQuotesForAddressChange,
    fetchShippingQuotes,
    isNewDeliveryAddressReady,
  } = useCheckoutShippingQuotes({
    isHydrated,
    merchantId: merchant?.id,
    merchantCountry,
    checkoutCart,
    checkoutCartCatalogSubtotal,
    quoteItemsFingerprint,
    deliveryCoordinates,
    persistedSelectedQuoteId,
    persistedSelectedProviderRateId,
    currentStep,
    setCurrentStep,
    setCheckoutField,
    setCheckoutFields,
    setDeliveryMethod,
    deliveryMethod,
    newAddressStreet,
    newAddressState,
    newAddressCity,
    customerPhone,
    firstName,
    lastName,
    customerEmail,
    isNewAddressMode,
    addresses,
    selectedAddressId,
  });
  const deliveryAddressHandlers = useCheckoutDeliveryAddressHandlers({
    clearInferredLocationDebounce,
    merchantCountry,
    resetQuotesForAddressChange,
    scheduleInferredLocationUpdate,
    setFields: setCheckoutFields,
    setIsNewAddressMode,
    setNewAddressCity,
    setNewAddressState,
    setSelectedAddressId,
    shippingStates,
  });
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
  const deliveryOptions = useCheckoutDeliveryOptions({
    airportRequiresQuote,
    airportType,
    airDeliveryQuotes,
    city: newAddressCity,
    deliveryMethod,
    doorDeliveryQuotes,
    fetchShippingQuotes: () => {
      if (isNewDeliveryAddressReady) {
        fetchShippingQuotes(
          newAddressStreet,
          newAddressState,
          newAddressCity,
          customerPhone,
          firstName,
          lastName,
          customerEmail
        );
      }
    },
    hasMerchantPickupQuote,
    isHydrated,
    isLoadingQuotes,
    isNewAddressMode,
    merchantSlug: merchant?.slug,
    newAddressState,
    selectedAddressId,
    selectedQuoteId,
    selectedQuoteMatchesDeliveryMethod,
    setAirportRequiresQuote: (required) =>
      setCheckoutField('airportRequiresQuote', required),
    setAirportType,
    setDeliveryMethod,
    selectDeliveryMethod,
    setSelectedQuoteId,
    stationPickupQuote,
    stationPickupQuotes,
  });
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



  // Wallet state (2025: auto-apply when balance > 0)
  const [walletBalance, setWalletBalance] = useState(0);
  const [walletLoading, setWalletLoading] = useState(false);
  const [payWithWallet, setPayWithWallet] = useState(false);
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

  const taxRate = merchant?.vat_registration_status === 'registered'
    ? (merchant.vat_rate ?? 7.5) / 100
    : 0;
  const orderTotals = useOrderTotals({
    cartTotal: effectiveItemSubtotal,
    deliveryCost,
    taxRate,
  });

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
    if (!tryBeginSubmission(redvaultStatus === 'pending' || redvaultStatus === 'held')) return;

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

    const preparedSubmission = prepareCheckoutOrderSubmission({
      payment: {
        method: paymentMethod,
        bankTransferAvailable: bankTransferCheckoutAvailable,
        paystackAvailable: paystackCheckoutAvailable,
        korapayAvailable: korapayCheckoutAvailable,
        redvaultAvailable: redvaultAvailability.available,
        remainingAmount,
        total,
      },
      delivery: {
        method: deliveryMethod,
        selectedQuoteId,
        selectedQuoteMatchesMethod: selectedQuoteMatchesDeliveryMethod,
        airportRequiresQuote,
        airportType,
        quotes: shippingQuotes,
        addresses,
        selectedAddressId,
        isNewAddressMode,
        newAddressStreet,
        newAddressCity,
        newAddressState,
        customerPhone,
        merchantCountry,
        deliveryCost,
      },
      identity: {
        merchantId: merchant.id,
        customerEmail,
        customerName: (firstName + ' ' + lastName).trim(),
        customerPhone,
        checkoutItems: buildCheckoutOrderItems(checkoutCart),
        useWalletCredit: checkoutValues.useWalletCredit,
        walletAmountUsed,
        discountCode: checkoutValues.discountCode,
        giftWrappingCost,
      },
    });
    if (preparedSubmission.kind === 'issue') {
      if (preparedSubmission.issue === 'delivery-option') {
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
      if (
        preparedSubmission.issue === 'bank-transfer-unavailable' ||
        preparedSubmission.issue === 'paystack-unavailable' ||
        preparedSubmission.issue === 'korapay-unavailable' ||
        preparedSubmission.issue === 'redvault-unavailable'
      ) {
        const unavailableMessage = {
          'bank-transfer-unavailable': 'Bank transfer is not available for this store yet. Please choose a different payment method.',
          'paystack-unavailable': 'Paystack is not available for this store yet. Please choose a different payment method.',
          'korapay-unavailable': 'Korapay is not available for this store yet. Please choose a different payment method.',
          'redvault-unavailable': 'Pay with UBA is not available right now. Please choose a different payment method.',
        }[preparedSubmission.issue];
        toast({
          title: 'Payment Unavailable',
          description: unavailableMessage,
          variant: 'destructive',
        });
        isOrderInFlightRef.current = false;
        return;
      }
      if (preparedSubmission.issue === 'klump-unavailable') {
        toast(KLUMP_WALLET_CREDIT_UNAVAILABLE_TOAST);
        releaseSubmission();
        return;
      }
      if (preparedSubmission.issue === 'incomplete-address') {
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
      if (preparedSubmission.issue === 'delivery-required') {
        toast({
          title: 'Delivery option required',
          description: 'Please select a delivery option to continue.',
          variant: 'destructive',
        });
        releaseSubmission();
        return;
      }
      toast({
        title: 'Shipping rate expired',
        description: 'Please select a delivery option again.',
        variant: 'destructive',
      });
      releaseSubmission();
      return;
    }
    setIsProcessing(true);

    const { items: orderItems, checkoutFingerprint } = preparedSubmission.identity;

    await submitFreshCheckout({
      redvaultPrepared: {
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
      },
      onRedvaultPaymentStarted: ({ orderId, currency, reference, total, orderNumber }) => {
          captureCheckoutPaymentStarted({
            currency,
            orderId,
            orderNumber,
            paymentMethod: 'uba_redvault',
            reference,
            total,
          });
      },
      lifecycle: {
          prepared: preparedSubmission,
          state: {
            pendingOrder: pendingCheckoutOrder,
            merchant,
            customer: {
              email: customerEmail,
              phone: customerPhone,
              name: `${firstName} ${lastName}`.trim(),
              firstName,
              lastName,
              userId: user?.id,
            },
            newsletterOptIn,
            paymentMethod,
            total,
            orderRequestSubtotal: checkoutCartTotal,
            subtotal: effectiveItemSubtotal,
            shipping: deliveryCost,
            tax: orderTotals?.taxAmount ?? 0,
            giftWrappingCost,
            discountAmount: checkoutValues.discountAmount,
            discountCode: checkoutValues.discountCode,
            useWalletCredit: checkoutValues.useWalletCredit,
            walletAmountUsed,
            currency: currencyCode,
            deliveryMethod,
            airportType,
            selectedQuoteId,
            selectedQuoteMatchesMethod:
              selectedQuoteMatchesDeliveryMethod,
            merchantCountry,
          },
          actions: {
            getIdempotencyKey: () =>
              getCheckoutIdempotencyKey(checkoutFingerprint),
            cart,
            removeFromCart,
            clearPendingCheckoutOrder,
            clearCheckoutIdempotencyKey: () =>
              clearCheckoutIdempotencyKey(checkoutFingerprint),
            onShippingRateRejected: () => {
              raiseCheckoutError(
                'Shipping cost changed — please refresh and try again.'
              );
            },
            getOrderErrorMessage: getCheckoutOrderErrorMessage,
            waitForResolvedCustomerAuth:
              waitForResolvedStorefrontCustomerAuth,
            isOrderInFlightRef,
            setIsProcessing,
            setRedvaultStatus,
            clearCheckoutSession,
            clearCart,
            pushSuccessRoute: (path) => router.push(asRoute(getHref(path))),
            onRedvaultSummary: setRedvaultSummary,
            onOrderCreated: () => {
              rotateCheckoutAttemptGeneration();
              setCheckoutOrderCreated(true);
            },
            onPendingSnapshot: setPendingCheckoutOrder,
            setRedvaultOrderReady,
            releaseSubmission,
          },
          redvault: {
            enabled: paymentMethod === 'uba_redvault' && !redvaultOrderReady,
            customerName: `${firstName} ${lastName}`.trim(),
          },
      },
      createPaymentOptions: (lifecycle) => {
        const {
          order,
          wallet: walletResult,
          amountDueToGateway,
          createdOrderNumber,
          orderChargeCurrency,
          billingAddress,
        } = lifecycle;
        const signupAttempt = { current: false };
        const signUpCustomer = (logSuccess = false) =>
          signUpCheckoutCustomer({
            attempt: signupAttempt,
            enabled: createAccount,
            hasUser: Boolean(user),
            password: accountPassword,
            email: customerEmail,
            firstName,
            lastName,
            phone: customerPhone,
            logSuccess,
          });
        return {
          dispatch: {
          merchant,
          paymentMethod,
          total,
          currencyCode,
          firstName,
          lastName,
          customerEmail,
          customerPhone,
          billingAddress,
          checkoutFingerprint,
          checkoutCart,
          cart,
          orderItems,
          walletFundedTransfer,
          waitForResolvedStorefrontCustomerAuth,
          setIsProcessing,
          isOrderInFlightRef,
          setDvaData,
          setDvaCountdown,
          setIsInitializingDva,
          setRedvaultStatus,
          setPendingCryptoOrder,
          setShowCryptoSelector,
          setCryptoPaymentData,
          clearPendingCheckoutOrder,
          clearCheckoutSession,
          clearCart,
          navigate: (path) => router.push(asRoute(getHref(path))),
          redirect: (url) => window.location.assign(url),
          payForMeDetails,
          },
          order,
          wallet: walletResult,
          amountDueToGateway,
          createdOrderNumber,
          orderChargeCurrency,
          checkoutFingerprint,
          paymentMethod,
          setWalletBalance,
          capturePaymentStarted: (reference) => {
            captureCheckoutPaymentStarted({
              currency: orderChargeCurrency,
              orderId: order.id,
              orderNumber: createdOrderNumber,
              paymentMethod,
              reference,
              total: order.total ?? total,
            });
          },
          completeSignup: signUpCustomer,
          signupBeforePayment:
            paymentMethod !== 'uba_redvault' &&
            createAccount &&
            !user &&
            accountPassword.length >= 6
              ? () => signUpCustomer(true)
              : undefined,
          releaseSubmission,
        };
      },
      handleError: handleSubmissionError,
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
        <CryptoPaymentModal
          data={cryptoPaymentData}
          verificationStatus={cryptoVerificationStatus}
          isVerifying={isVerifyingCrypto}
          copiedText={copiedText}
          onVerify={verifyCryptoPayment}
          onCopyToClipboard={copyToClipboard}
          onClose={dismissCryptoModal}
          onCloseConfirm={() => {
            const confirmed = confirm(
              'Are you sure you want to close? If you\'ve already sent payment, your order will still be processed once the payment is detected.'
            );
            if (confirmed) dismissCryptoModal();
          }}
        />
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
        <DvaModal
          data={dvaData}
          copiedText={copiedText}
          formatCurrency={formatCurrencyAuto}
          isVerifying={isVerifyingDva}
          onClose={closeDvaModal}
          onConfirmTransfer={handleDvaConfirmTransfer}
          onCopyToClipboard={copyToClipboard}
        />
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
              onComplete={completeContact}
            />

            <CheckoutDeliveryStep
              active={currentStep === 'delivery'}
              addressFields={{
                signedIn: Boolean(user),
                addresses,
                isNewAddressMode,
                selectedAddressId,
                newAddressStreet,
                newAddressCity,
                newAddressState,
                merchantCountry,
                addressReady: isHydrated && isNewDeliveryAddressReady,
                onToggleAddressMode: () =>
                  setIsNewAddressMode(!isNewAddressMode),
                onSelectAddress: deliveryAddressHandlers.onSelectAddress,
                onStreetChange: deliveryAddressHandlers.onStreetChange,
                onSelectPlace: deliveryAddressHandlers.onSelectPlace,
              }}
              completed={completedSteps.delivery}
              deliveryOptions={deliveryOptions}
              disabled={!completedSteps.contact}
              focusOnActivate={focusActiveStep}
              isDeliveryValid={isDeliveryValid}
              onContinue={() => {
                captureClientEvent(
                  CHECKOUT_FUNNEL_EVENTS.checkoutStepCompleted,
                  buildCheckoutFunnelProperties({
                    channel: 'web',
                    checkoutStep: 'shipping_info',
                    source: 'web_checkout',
                  })
                );
                setCompletedSteps((prev) => ({ ...prev, delivery: true }));
                setCurrentStep('payment');
              }}
              onOpen={() => setCurrentStep('delivery')}
              summary={
                deliveryMethod === 'door'
                  ? `By Road${newAddressCity ? ` · ${newAddressCity}` : ''}`
                  : deliveryMethod === 'pickup_station'
                    ? 'Pickup Station'
                    : deliveryMethod === 'pickup'
                      ? 'Store Pickup'
                      : 'By Air'
              }
            />

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
