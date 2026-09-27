import { mapApiOrderToResumedOrder } from './map-api-order-to-resumed-order';
import type { PaymentMethod, PaymentTab, ResumedOrder } from './types';

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
  signal?: AbortSignal;
  preferredGateway: 'credpal' | 'credit_direct' | null;
  setIsLoadingResumedOrder: (isLoading: boolean) => void;
  setResumedOrder: (order: ResumedOrder | null) => void;
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
  signal,
  setIsLoadingResumedOrder,
  setResumedOrder,
  setCheckoutFields,
  setPaymentTab,
  setPaymentMethod,
  setResumeOrderError,
}: LoadResumedCheckoutOrderParams): Promise<void> {
  setIsLoadingResumedOrder(true);
  setResumeOrderError(null);
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
        : `/api/storefront/orders/${resumeOrderId}`,
      { signal }
    );
    if (signal?.aborted) return;
    if (res.ok) {
      const orderData = await res.json();
      if (signal?.aborted) return;
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
      if (
        preferredGateway === 'credit_direct' ||
        preferredGateway === 'credpal'
      ) {
        setPaymentTab('installments');
        setPaymentMethod(preferredGateway);
      } else if (preferredGateway) {
        setPaymentTab('full');
        setPaymentMethod(preferredGateway);
      }
    } else {
      console.error('Failed to fetch resumed order');
      setResumeOrderError(
        'Order not found. It may have been completed or expired.'
      );
    }
  } catch (error) {
    if (signal?.aborted) return;
    console.error('Error fetching resumed order:', error);
    setResumeOrderError('Failed to load order details. Please try again.');
  } finally {
    if (!signal?.aborted) setIsLoadingResumedOrder(false);
  }
}
