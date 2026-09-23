import { getSubdivisions } from '@/lib/shipping/merchant-rates/subdivisions';
import { mapApiOrderToResumedOrder } from './map-api-order-to-resumed-order';
import type {
  DvaData,
  PaymentMethod,
  PaymentTab,
  ResumedOrder,
} from './types';

/**
 * Module-level checkout data loaders extracted from checkout-page.tsx:
 * resumed-order hydration, shipping-state lookup, wallet balance, and
 * DVA initialization. Each takes explicit setter params so the page
 * component stays a thin orchestrator.
 */

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

export interface LoadResumedCheckoutOrderParams {
  resumeOrderId: string;
  resumeMerchantSlug: string;
  resumeTrackingToken: string | null;
  resumeLookupEmail: string | null;
  preferredGateway: 'credpal' | 'credit_direct' | null;
  setIsLoadingResumedOrder: (isLoading: boolean) => void;
  setResumedOrder: (order: ResumedOrder) => void;
  setCheckoutFields: (fields: ResumedOrderFormFields) => void;
  setPaymentTab: (tab: PaymentTab) => void;
  setPaymentMethod: (method: PaymentMethod) => void;
  setResumeOrderError: (error: string | null) => void;
}

export async function loadResumedCheckoutOrder({
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
      const resumed = mapApiOrderToResumedOrder(orderData);
      setResumedOrder(resumed);

      // Pre-fill form with order data
      const [first, ...rest] = (resumed.customer_name || '').split(' ');
      setCheckoutFields({
        firstName: first || '',
        lastName: rest.join(' ') || '',
        customerEmail: resumed.customer_email || '',
        customerPhone: resumed.customer_phone || '',
        newAddressStreet: resumed.shipping_address?.address || '',
        newAddressState: resumed.shipping_address?.state || '',
        newAddressCity: resumed.shipping_address?.city || '',
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

export interface LoadShippingStatesParams {
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

export async function loadShippingStates({
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

export interface LoadWalletBalanceParams {
  merchantSlug: string;
  signal: AbortSignal;
  setWalletLoading: (isLoading: boolean) => void;
  setWalletBalance: (balance: number) => void;
  setPayWithWallet: (payWithWallet: boolean) => void;
}

export async function loadWalletBalance({
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


export interface RequestDvaInitializationParams {
  merchantId: string;
  orderId: string;
  customerEmail: string;
  customerName: string;
  customerPhone: string;
  billingAddress: DvaBillingAddress;
  /** Merchant-resolved fiat order currency (server derives from order). */
  orderCurrency: string;
}

export interface DvaBillingAddress {
  line1: string;
  city: string;
  state?: string;
  country: string;
  zip_code?: string;
}

export async function requestDvaInitialization({
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
