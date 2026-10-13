import { mapApiOrderToResumedOrder } from './map-api-order-to-resumed-order';
import type { ResumedOrder } from './types';

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
  setIsLoadingResumedOrder: (isLoading: boolean) => void;
  setResumedOrder: (order: ResumedOrder | null) => void;
  setCheckoutFields: (fields: ResumedOrderFormFields) => void;
  setResumeOrderError: (error: string | null) => void;
}

export async function loadResumedCheckoutOrder({
  resumeOrderId,
  resumeMerchantSlug,
  resumeTrackingToken,
  resumeLookupEmail,
  signal,
  setIsLoadingResumedOrder,
  setResumedOrder,
  setCheckoutFields,
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
