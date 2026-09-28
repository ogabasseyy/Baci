'use client';
import { useCheckoutAddressInference } from './checkout/hooks/use-checkout-address-inference';
import { useCheckoutPaymentSession } from './checkout/hooks/use-checkout-payment-session';
import { useOrderTotals } from './checkout/hooks/use-order-totals';
import { resolveCheckoutResumeContext } from './checkout/resolve-checkout-resume-context';

import { useCheckoutDeliverySession } from './checkout/hooks/use-checkout-delivery-session';
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
import {
  DiscountCodeInput,
} from '@/components/storefront/checkout/discount-code-input';
import { MobileOrderSummary } from '../components/MobileCheckoutComponents';
import { useRouter, useSearchParams } from 'next/navigation';
import type React from 'react';
import { useCheckoutFormState } from './checkout/hooks/use-checkout-form-state';
import { useCheckoutStepState } from './checkout/hooks/use-checkout-step-state';
import {
  useJuicywayPayment,
  type JuicywayPendingOrder,
} from './checkout/hooks/use-juicyway-payment';
import { usePaymentReturnReset } from './checkout/use-payment-return-reset';
import { useEffect, useState, useRef } from 'react';
import { useCart } from '@/hooks/cart';
import { useMerchantSafe } from '@/hooks/use-merchant-client';
import { useCurrency } from '@/hooks/use-currency';
import type {
  CryptoChain,
  CryptoCurrency,
  DvaData,
  PendingCryptoOrder,
  ResumedOrder,
} from './checkout/types';
import { mapApiOrderToResumedOrder } from './checkout/map-api-order-to-resumed-order';
import { loadShippingStates } from './checkout/checkout-page-data-loaders';
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
import { clearCheckoutIdempotencyKey } from './checkout/checkout-idempotency';
import { captureCheckoutPaymentCompleted } from './checkout/capture-checkout-payment-completed';
import { useCheckoutSubmissionState } from './checkout/hooks/use-checkout-submission-state';
import { executeResumedDirectPayment } from './checkout/handlers/direct-payment';
import { captureClientEvent } from '@/lib/posthog/capture-client-event';
import { PaymentStep } from './checkout/components/PaymentStep';
import { useRedvaultPaymentAvailability } from './checkout/hooks/use-redvault-payment-availability';
import {
  inferAddressLocationFromInput,
} from './checkout/utils';
import { useCheckoutOrderSubmission } from './checkout/hooks/use-checkout-order-submission';
import { useWalletFundedBankTransfer } from './checkout/hooks/use-wallet-funded-bank-transfer';
import { useStorefrontCustomerSession } from './checkout/hooks/use-storefront-customer-session';
import {
  useResumedCheckoutStartFunnel,
} from './checkout/hooks/use-resumed-checkout-start-funnel';
import {
  deriveCheckoutDisplayModel,
  deriveCheckoutSummaryAmounts,
} from './checkout/derive-checkout-display-model';
import { deriveCheckoutPaymentBaseTotal } from './checkout/derive-checkout-payment-base-total';
import { readCheckoutAttemptGeneration } from './checkout/checkout-attempt-generation';
import { DeferredWalletFundedTransferModal as WalletFundedTransferModal } from './checkout/components/DeferredWalletFundedTransferModal';
import { DeferredWalletTransferConsentDialog as WalletTransferConsentDialog } from './checkout/components/DeferredWalletTransferConsentDialog';
import {
  DesktopOrderSummary,
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
  const inferredLocation = useCheckoutAddressInference(setCheckoutFields);
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

  const {
    displayItems,
    effectiveCheckoutCartTotal,
    effectiveItemSubtotal,
    summarySubtotal,
    hasCheckoutCartItems,
    mobileSummaryCart,
    summaryOrder,
  } = deriveCheckoutDisplayModel({
    checkoutCart,
    checkoutCartTotal,
    currencyCode,
    itemSubtotal,
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

  const delivery = useCheckoutDeliverySession({
    airportRequiresQuote,
    airportType,
    completedSteps,
    inferredLocation,
    isHydrated,
    merchantId: merchant?.id,
    merchantCountry,
    merchantSlug: merchant?.slug,
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
    deliveryMethod,
    newAddressStreet,
    newAddressState,
    newAddressCity,
    customerPhone,
    firstName,
    lastName,
    customerEmail,
  });
  const {
    address: deliveryAddress,
    method: deliverySelection,
    quotes: deliveryQuotes,
    options: deliveryOptions,
    validation: { isValid: isDeliveryValid },
    cost: deliveryCost,
  } = delivery;
  const { addresses, selectedId: selectedAddressId, isNewMode: isNewAddressMode } = deliveryAddress;
  const { setIsLoadingLocations, setShippingStates } = deliveryAddress;
  const {
    items: shippingQuotes,
    selectedId: selectedQuoteId,
    matchesSelectedMethod: selectedQuoteMatchesDeliveryMethod,
  } = deliveryQuotes;
  const { isNewDeliveryAddressReady } = deliveryAddress;
  const deliveryAddressHandlers = deliveryAddress.handlers;

  // Note: newAddressState, newAddressCity, newAddressStreet are now part of checkoutForm (persisted)


  // Payment State (declared before the resumed-order effect below, which
  // pre-selects the tab/method for BNPL deep links — React Compiler requires
  // declaration before first access)
  const taxRate = merchant?.vat_registration_status === 'registered'
    ? (merchant.vat_rate ?? 7.5) / 100
    : 0;
  const orderTotals = useOrderTotals({
    cartTotal: effectiveItemSubtotal,
    deliveryCost,
    taxRate,
  });
  const paymentSession = useCheckoutPaymentSession({
    baseTotal: deriveCheckoutPaymentBaseTotal({
      effectiveCheckoutCartTotal,
      deliveryCost,
      giftWrappingCost,
      hasCheckoutCartItems,
      taxAmount: orderTotals?.taxAmount ?? 0,
      resumedOrderTotal: summaryOrder?.total ?? null,
    }),
    clearPendingCheckoutOrder,
    currencyCode,
    discountSubtotal: effectiveCheckoutCartTotal,
    hasAuthenticatedUser: Boolean(user),
    isOrderInFlightRef,
    merchantSlug: merchant?.slug ?? undefined,
    pendingCheckoutOrder,
    walletSessionIdentity: user,
    resumeOrder: {
      resumeOrderId,
      resumeMerchantSlug,
      resumeTrackingToken,
      resumeLookupEmail,
      preferredGateway,
      setIsLoadingResumedOrder,
      setResumedOrder,
      setCheckoutFields,
      setResumeOrderError,
    },
  });
  const summaryAmounts = deriveCheckoutSummaryAmounts({
    deliveryCost,
    deliveryMethod,
    discountAmount: paymentSession.checkoutValues.discountAmount,
    giftWrappingCost,
    hasCheckoutCartItems,
    orderTotals,
    resumedOrder,
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



  // Note: currentStep and completedSteps are now part of checkoutForm (persisted)

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

  const paymentMethod = paymentSession.method;
  const redvaultStatus = paymentSession.redvault.status;
  const redvaultOrderReady = paymentSession.redvault.orderReady;
  const walletAmountUsed = paymentSession.wallet.amountUsed;
  const remainingAmount = paymentSession.wallet.remainingAmount;
  const total = paymentSession.total;


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

  const { handlePlaceOrder } = useCheckoutOrderSubmission({
    account: {
      createAccount,
      password: accountPassword,
      user,
      waitForResolvedCustomerAuth: waitForResolvedStorefrontCustomerAuth,
    },
    cart: {
      cart,
      checkoutCart,
      checkoutCartTotal,
      clearCart,
      removeFromCart,
    },
    contact: {
      customerEmail,
      customerPhone,
      firstName,
      lastName,
      newsletterOptIn,
    },
    delivery: {
      session: delivery,
      method: deliveryMethod,
      airportType,
      airportRequiresQuote,
      newAddressStreet,
      newAddressCity,
      newAddressState,
      merchantCountry,
      giftWrappingCost,
      effectiveItemSubtotal,
      taxAmount: orderTotals?.taxAmount ?? 0,
    },
    merchant,
    navigation: {
      setCurrentStep,
      setCompletedSteps,
      pushSuccessRoute: (url) => router.push(asRoute(url)),
      getHref,
    },
    order: {
      pending: pendingCheckoutOrder,
      clearPending: clearPendingCheckoutOrder,
      setPending: setPendingCheckoutOrder,
      setOrderCreated: setCheckoutOrderCreated,
      clearCheckoutSession,
      setDvaData,
      setDvaCountdown,
      setIsInitializingDva,
      setPendingCryptoOrder,
      setShowCryptoSelector,
      setCryptoPaymentData,
      walletFundedTransfer,
    },
    payment: {
      session: paymentSession,
      bankTransferAvailable: bankTransferCheckoutAvailable,
      paystackAvailable: paystackCheckoutAvailable,
      korapayAvailable: korapayCheckoutAvailable,
      redvaultAvailable: redvaultAvailability.available,
      currencyCode,
    },
    resumed: {
      order: resumedOrder,
      preferredGateway,
      trackingToken: resumeTrackingToken,
      merchantSlugFromResume: resumeMerchantSlug,
    },
    processing: {
      setIsProcessing,
      isOrderInFlightRef,
      tryBeginSubmission,
      releaseSubmission,
      handleSubmissionError,
    },
  });

  const isPayForMeValid = paymentSession.payForMe.isValid;

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
          cartTotal={summarySubtotal}
          deliveryCost={summaryAmounts.summaryDeliveryCost}
          taxAmount={summaryAmounts.summaryTaxAmount}
          discountAmount={summaryAmounts.summaryDiscountAmount}
          deliveryMethod={summaryAmounts.summaryDeliveryMethod}
          giftWrappingCost={summaryAmounts.summaryGiftWrappingCost}
          walletBalance={paymentSession.wallet.balance}
          payWithWallet={paymentSession.checkoutValues.payWithWallet}
          walletAmountUsed={walletAmountUsed}
          remainingAmount={summaryOrder?.total ?? remainingAmount}
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
              appliedDiscount={paymentSession.discount.applied}
              onApply={paymentSession.discount.setApplied}
              onRemove={() => paymentSession.discount.setApplied(null)}
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
                  deliveryAddress.setIsNewMode(!isNewAddressMode),
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
              paymentTab={paymentSession.tab}
              setPaymentTab={paymentSession.setTab}
              paymentMethod={paymentMethod}
              setPaymentMethod={paymentSession.selectMethod}
              isProcessing={isProcessing}
              isPayForMeValid={isPayForMeValid}
              isDeliveryValid={isDeliveryValid}
              payForMeDetails={paymentSession.payForMe.details}
              setPayForMeDetails={paymentSession.payForMe.setDetails}
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
              redvaultSummary={paymentSession.redvault.summary}
              redvaultOrderReady={Boolean(redvaultOrderReady)}
            />

          </div>

          <DesktopOrderSummary
            displayItems={displayItems}
            formatCurrencyAuto={formatCurrencyAuto}
            summarySubtotal={summarySubtotal}
            orderTotals={summaryAmounts.summaryOrderTotals}
            taxLabel={summaryAmounts.summaryTaxLabel}
            deliveryCost={summaryAmounts.summaryDeliveryCost}
            deliveryMethod={summaryAmounts.summaryDeliveryMethod}
            discountAmount={summaryAmounts.summaryDiscountAmount}
            selectedQuoteId={selectedQuoteId}
            giftWrappingCost={summaryAmounts.summaryGiftWrappingCost}
            paymentMethod={paymentMethod}
            walletCurrencySupported={paymentSession.wallet.currencySupported}
            walletLoading={paymentSession.wallet.loading}
            walletBalance={paymentSession.wallet.balance}
            hasUser={Boolean(user)}
            currencySymbol={currencySymbol}
            payWithWallet={paymentSession.wallet.payWithWallet}
            setPayWithWallet={paymentSession.wallet.setPayWithWallet}
            walletAmountUsed={walletAmountUsed}
            remainingAmount={remainingAmount}
            checkoutPayWithWallet={paymentSession.checkoutValues.payWithWallet}
            redvaultSummary={paymentSession.redvault.summary}
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
