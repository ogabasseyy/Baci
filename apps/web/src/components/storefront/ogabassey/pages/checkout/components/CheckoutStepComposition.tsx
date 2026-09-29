'use client';

import { User } from 'lucide-react';
import type { ComponentProps } from 'react';
import { CheckoutDeliveryStep } from './CheckoutDeliveryStep';
import { ContactStep } from './ContactStep';
import { PaymentStep } from './PaymentStep';

type CheckoutStepName = ComponentProps<typeof PaymentStep>['currentStep'];
type CompletedSteps = ComponentProps<typeof PaymentStep>['completedSteps'];

type FlowState = {
  currentStep: CheckoutStepName;
  completedSteps: CompletedSteps;
  focusOnActivate: boolean;
  signedIn: boolean;
};

type ContactStepInputs = Omit<
  ComponentProps<typeof ContactStep>,
  'active' | 'completed' | 'focusOnActivate' | 'signedIn'
>;

type DeliveryStepInputs = Omit<
  ComponentProps<typeof CheckoutDeliveryStep>,
  'active' | 'completed' | 'disabled' | 'focusOnActivate'
>;

type PaymentStepInputs = Omit<
  ComponentProps<typeof PaymentStep>,
  'completedSteps' | 'currentStep' | 'focusOnActivate'
>;

interface CheckoutStepCompositionProps {
  flow: FlowState;
  onSignIn: () => void;
  contact: ContactStepInputs;
  delivery: DeliveryStepInputs;
  payment: PaymentStepInputs;
}

/** Renders the guest prompt and the ordered contact, delivery, and payment panels. */
export function CheckoutStepComposition({
  flow,
  onSignIn,
  contact,
  delivery,
  payment,
}: CheckoutStepCompositionProps) {
  return (
    <div className="lg:col-span-8 space-y-6">
      {!flow.signedIn && flow.currentStep === 'contact' && (
        <div className="bg-blue-50 border border-blue-100 rounded-2xl p-4 flex items-center justify-between animate-in fade-in slide-in-from-top-2 duration-500">
          <div className="flex items-center gap-3">
            <div className="size-10 bg-white rounded-xl flex items-center justify-center shadow-sm">
              <User size={20} className="text-blue-600" />
            </div>
            <div>
              <h4 className="text-sm font-bold text-gray-900">
                Already have an account?
              </h4>
              <p className="text-xs text-gray-500">
                Sign in to use your saved addresses and track orders.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onSignIn}
            className="px-4 py-2 bg-white text-blue-600 font-bold text-xs rounded-lg border border-blue-200 hover:bg-blue-50 transition-colors shadow-sm active:scale-95"
          >
            Sign In
          </button>
        </div>
      )}

      <ContactStep
        {...contact}
        active={flow.currentStep === 'contact'}
        completed={flow.completedSteps.contact}
        focusOnActivate={flow.focusOnActivate}
        signedIn={flow.signedIn}
      />

      <CheckoutDeliveryStep
        {...delivery}
        active={flow.currentStep === 'delivery'}
        completed={flow.completedSteps.delivery}
        disabled={!flow.completedSteps.contact}
        focusOnActivate={flow.focusOnActivate}
      />

      <PaymentStep
        {...payment}
        completedSteps={flow.completedSteps}
        currentStep={flow.currentStep}
        focusOnActivate={flow.focusOnActivate}
      />
    </div>
  );
}
