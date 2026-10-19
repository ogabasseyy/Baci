'use client';

import type { User } from '@supabase/supabase-js';
import { useState } from 'react';
import { useCheckoutAddressInference } from './use-checkout-address-inference';
import { useCheckoutCustomerPrefill } from './use-checkout-customer-prefill';
import { useCheckoutFormState } from './use-checkout-form-state';
import { useCheckoutStepState } from './use-checkout-step-state';

interface UseCheckoutFormSessionOptions {
  isHydrated: boolean;
  user: User | null | undefined;
}

/** Own persisted checkout fields and the transient contact/auth form session. */
export function useCheckoutFormSession({
  isHydrated,
  user,
}: UseCheckoutFormSessionOptions) {
  const persisted = useCheckoutFormState();
  const flow = useCheckoutStepState({
    isHydrated,
    currentStep: persisted.values.currentStep,
    completedSteps: persisted.values.completedSteps,
    setField: persisted.setValue,
    setFields: persisted.setValues,
  });
  const inferredLocation = useCheckoutAddressInference(persisted.setValues);
  const [createAccount, setCreateAccount] = useState(false);
  const [password, setPassword] = useState('');
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);

  useCheckoutCustomerPrefill({
    user,
    values: {
      customerEmail: persisted.values.customerEmail,
      customerPhone: persisted.values.customerPhone,
      firstName: persisted.values.firstName,
      lastName: persisted.values.lastName,
    },
    setFields: persisted.setValues,
  });

  return {
    form: {
      values: persisted.values,
      contactValues: {
        firstName: persisted.values.firstName,
        lastName: persisted.values.lastName,
        customerEmail: persisted.values.customerEmail,
        customerPhone: persisted.values.customerPhone,
      },
      setField: persisted.setValue,
      setFields: persisted.setValues,
      setNewsletterOptIn: (value: boolean) =>
        persisted.setValue('newsletterOptIn', value),
      clear: persisted.clear,
      inferredLocation,
    },
    flow: {
      currentStep: flow.currentStep,
      completedSteps: flow.completedSteps,
      focusOnActivate: flow.focusActiveStep,
      signedIn: Boolean(user),
      setCurrentStep: flow.setCurrentStep,
      setCompletedSteps: flow.setCompletedSteps,
      completeContact: flow.completeContact,
    },
    account: {
      createAccount,
      password,
      setCreateAccount,
      setPassword,
    },
    auth: {
      isOpen: isAuthModalOpen,
      onOpenChange: setIsAuthModalOpen,
      open: () => setIsAuthModalOpen(true),
      close: () => setIsAuthModalOpen(false),
    },
  };
}
