'use client';

import { useState } from 'react';
import type { useCheckoutFormState } from './use-checkout-form-state';

type CheckoutForm = ReturnType<typeof useCheckoutFormState>;
type CheckoutStep = CheckoutForm['values']['currentStep'];
type CompletedSteps = CheckoutForm['values']['completedSteps'];

interface CheckoutStepStateOptions {
  isHydrated: boolean;
  currentStep: CheckoutStep;
  completedSteps: CompletedSteps;
  setField: CheckoutForm['setValue'];
  setFields: CheckoutForm['setValues'];
}

/** Keep the initial HTML stable, then restore persisted navigation without stealing focus. */
export function useCheckoutStepState({
  isHydrated,
  currentStep: persistedStep,
  completedSteps: persistedCompletedSteps,
  setField,
  setFields,
}: CheckoutStepStateOptions) {
  const currentStep = isHydrated ? persistedStep : 'contact';
  const completedSteps = isHydrated
    ? persistedCompletedSteps
    : { contact: false, delivery: false };
  const [focusActiveStep, setFocusActiveStep] = useState(false);

  const setCurrentStep = (step: CheckoutStep) => {
    setFocusActiveStep(true);
    setField('currentStep', step);
  };
  const setCompletedSteps = (
    value: CompletedSteps | ((previous: CompletedSteps) => CompletedSteps)
  ) => {
    setField(
      'completedSteps',
      typeof value === 'function' ? value(completedSteps) : value
    );
  };
  const completeContact = () => {
    setFocusActiveStep(true);
    setFields({
      currentStep: 'delivery',
      completedSteps: { ...completedSteps, contact: true },
    });
  };

  return {
    currentStep,
    completedSteps,
    focusActiveStep,
    setCurrentStep,
    setCompletedSteps,
    completeContact,
  };
}
