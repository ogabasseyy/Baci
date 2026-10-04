'use client';

import type { User } from '@supabase/supabase-js';
import { useEffect } from 'react';
import type { useCheckoutFormState } from './use-checkout-form-state';

type CheckoutForm = ReturnType<typeof useCheckoutFormState>;
type ContactValues = Pick<
  CheckoutForm['values'],
  'customerEmail' | 'customerPhone' | 'firstName' | 'lastName'
>;

interface UseCheckoutCustomerPrefillOptions {
  user: User | null | undefined;
  values: ContactValues;
  setFields: CheckoutForm['setValues'];
}

function readMetadataString(user: User, key: string): string | undefined {
  const value: unknown = user.user_metadata?.[key];
  return typeof value === 'string' ? value : undefined;
}

/** Fill empty checkout contact fields from the authenticated customer profile. */
export function useCheckoutCustomerPrefill({
  user,
  values,
  setFields,
}: UseCheckoutCustomerPrefillOptions) {
  const { customerEmail, customerPhone, firstName, lastName } = values;

  useEffect(() => {
    if (!user) return;

    const updates: Partial<ContactValues> = {};
    if (user.email && !customerEmail) {
      updates.customerEmail = user.email;
    }

    if (!firstName && !lastName) {
      const profileFirstName = readMetadataString(user, 'first_name');
      const profileLastName = readMetadataString(user, 'last_name');
      if (profileFirstName || profileLastName) {
        updates.firstName = profileFirstName || '';
        updates.lastName = profileLastName || '';
      } else {
        const profileName =
          readMetadataString(user, 'full_name') ||
          readMetadataString(user, 'name');
        if (profileName) {
          const [profileFirst, ...profileRest] = profileName.split(' ');
          updates.firstName = profileFirst || '';
          updates.lastName = profileRest.join(' ') || '';
        }
      }
    }

    const profilePhone = readMetadataString(user, 'phone');
    if (profilePhone && !customerPhone) {
      updates.customerPhone = profilePhone;
    }

    if (Object.keys(updates).length > 0) {
      setFields(updates);
    }
  }, [customerEmail, customerPhone, firstName, lastName, setFields, user]);
}
