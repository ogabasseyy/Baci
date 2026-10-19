'use client';
import { useState } from 'react';
import {
  type CheckoutAccountValues,
  CONTACT_FIELD_IDS,
  type ContactValues,
  getContactErrors,
} from '../contact-validation';
import { CheckoutAccountFields } from './CheckoutAccountFields';
import { CheckoutStepSection } from './CheckoutStepSection';
import { ContactFields } from './ContactFields';

export interface ContactStepProps {
  active: boolean;
  focusOnActivate?: boolean;
  completed: boolean;
  values: ContactValues;
  onChange: (key: keyof ContactValues, value: string) => void;
  account: CheckoutAccountValues;
  onAccountChange: (value: CheckoutAccountValues) => void;
  signedIn: boolean;
  onOpen: () => void;
  onComplete: () => void;
}

export function ContactStep({
  active,
  focusOnActivate,
  completed,
  values,
  onChange,
  account,
  onAccountChange,
  signedIn,
  onOpen,
  onComplete,
}: ContactStepProps) {
  const [attempted, setAttempted] = useState(false);
  const errors = getContactErrors(values, signedIn ? undefined : account);
  const summary = [
    [values.firstName, values.lastName].filter(Boolean).join(' '),
    values.customerPhone,
  ]
    .filter(Boolean)
    .join(' · ');
  function continueToDelivery() {
    setAttempted(true);
    const firstError = (
      Object.keys(CONTACT_FIELD_IDS) as (keyof typeof CONTACT_FIELD_IDS)[]
    ).find((key) => errors[key]);
    if (firstError) {
      document.getElementById(CONTACT_FIELD_IDS[firstError])?.focus();
      return;
    }
    onComplete();
  }
  return (
    <CheckoutStepSection
      id="checkout-contact"
      title="Contact Information"
      number={1}
      active={active}
      focusOnActivate={focusOnActivate}
      completed={completed}
      summary={summary}
      onOpen={onOpen}
    >
      <ContactFields
        values={values}
        errors={attempted ? errors : {}}
        onChange={onChange}
      />
      {!signedIn && (
        <CheckoutAccountFields
          account={account}
          onChange={onAccountChange}
          error={attempted ? errors.accountPassword : undefined}
        />
      )}
      <div className="pt-2">
        <button
          type="button"
          onClick={continueToDelivery}
          className="px-6 py-3 bg-store-primary text-white font-bold rounded-xl hover:bg-store-primary/90 transition-colors w-full md:w-auto shadow-lg"
        >
          Continue to Delivery
        </button>
      </div>
    </CheckoutStepSection>
  );
}
