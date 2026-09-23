'use client';

import { useEffect, useState } from 'react';
import { mapApiOrderToResumedOrder } from '../map-api-order-to-resumed-order';
import type { PaymentMethod, ResumedOrder } from '../types';

interface SetCheckoutFieldsFn {
  (values: {
    firstName: string;
    lastName: string;
    customerEmail: string;
    customerPhone: string;
    newAddressStreet: string;
    newAddressState: string;
    newAddressCity: string;
    currentStep: 'contact' | 'delivery' | 'payment';
    completedSteps: { contact: boolean; delivery: boolean };
  }): void;
}

interface UseOrderResumeOptions {
  resumeOrderId: string | null;
  preferredGateway: 'credpal' | 'credit_direct' | null;
  setCheckoutFields: SetCheckoutFieldsFn;
  setPaymentTab: (tab: 'full' | 'installments') => void;
  setPaymentMethod: (method: PaymentMethod) => void;
}

type ResumedOrderFetchResult =
  | { order: ResumedOrder; error: null }
  | { order: null; error: string };

/**
 * Module-scope fetch keeps the try/finally clause out of the hook body so
 * React Compiler can memoize callers.
 */
async function fetchResumedOrder(
  resumeOrderId: string
): Promise<ResumedOrderFetchResult> {
  try {
    const res = await fetch(`/api/storefront/orders/${resumeOrderId}`);
    if (!res.ok) {
      console.error('Failed to fetch resumed order');
      return {
        order: null,
        error: 'Order not found. It may have been completed or expired.',
      };
    }

    const orderData = await res.json();
    return {
      order: mapApiOrderToResumedOrder(orderData),
      error: null,
    };
  } catch (error) {
    console.error('Error fetching resumed order:', error);
    return { order: null, error: 'Failed to load order details. Please try again.' };
  }
}

export function useOrderResume({
  resumeOrderId,
  preferredGateway,
  setCheckoutFields,
  setPaymentTab,
  setPaymentMethod,
}: UseOrderResumeOptions) {
  const [resumedOrder, setResumedOrder] = useState<ResumedOrder | null>(null);
  const [isLoadingResumedOrder, setIsLoadingResumedOrder] = useState(!!resumeOrderId);
  const [resumeOrderError, setResumeOrderError] = useState<string | null>(null);

  // Re-enter the loading state during render when the order id changes
  // (react.dev prev-compare pattern) instead of synchronously inside the effect.
  const [prevResumeOrderId, setPrevResumeOrderId] = useState(resumeOrderId);
  if (resumeOrderId !== prevResumeOrderId) {
    setPrevResumeOrderId(resumeOrderId);
    if (resumeOrderId) setIsLoadingResumedOrder(true);
  }

  useEffect(() => {
    if (!resumeOrderId) return;

    fetchResumedOrder(resumeOrderId).then((result) => {
      if (result.order) {
        const order = result.order;
        setResumedOrder(order);

        const [first, ...rest] = (order.customer_name || '').split(' ');
        setCheckoutFields({
          firstName: first || '',
          lastName: rest.join(' ') || '',
          customerEmail: order.customer_email || '',
          customerPhone: order.customer_phone || '',
          newAddressStreet: order.shipping_address?.address || '',
          newAddressState: order.shipping_address?.state || '',
          newAddressCity: order.shipping_address?.city || '',
          currentStep: 'payment',
          completedSteps: { contact: true, delivery: true },
        });

        if (preferredGateway === 'credit_direct' || preferredGateway === 'credpal') {
          setPaymentTab('installments');
          setPaymentMethod(preferredGateway);
        } else if (preferredGateway) {
          setPaymentTab('full');
          setPaymentMethod(preferredGateway);
        }
      } else {
        setResumeOrderError(result.error);
      }
      setIsLoadingResumedOrder(false);
    });
  }, [resumeOrderId, setCheckoutFields, preferredGateway]);

  return { resumedOrder, isLoadingResumedOrder, resumeOrderError };
}
