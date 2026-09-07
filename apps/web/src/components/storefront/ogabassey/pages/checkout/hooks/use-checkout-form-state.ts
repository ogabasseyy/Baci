'use client';

import { usePersistedForm } from '@/hooks/use-persisted-state';
import type { DeliveryMethod } from '../types';

const initialValues = {
  firstName: '',
  lastName: '',
  customerEmail: '',
  customerPhone: '',
  newAddressStreet: '',
  newAddressState: '',
  newAddressCity: '',
  currentStep: 'contact' as 'contact' | 'delivery' | 'payment',
  completedSteps: { contact: false, delivery: false },
  deliveryCoordinates: null as { latitude: number; longitude: number } | null,
  deliveryMethod: 'door' as DeliveryMethod,
  newsletterOptIn: false,
};

// Persist destination and consent together with the contact form so provider
// navigation restores the same checkout instead of recreating defaults.
export function useCheckoutFormState() {
  const form = usePersistedForm('checkout-form', initialValues);
  return { ...form, values: { ...initialValues, ...form.values } };
}
