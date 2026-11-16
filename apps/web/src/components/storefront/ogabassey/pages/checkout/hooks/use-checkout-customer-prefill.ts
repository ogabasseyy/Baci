'use client';

import type { User } from '@supabase/supabase-js';
import { useEffect, useRef } from 'react';
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
  const initialized = useRef<{
    userId: string | null;
    email: boolean;
    name: boolean;
    phone: boolean;
  }>({
    userId: null,
    email: false,
    name: false,
    phone: false,
  });

  useEffect(() => {
    if (user === null) {
      initialized.current = {
        userId: null,
        email: false,
        name: false,
        phone: false,
      };
      return;
    }
    if (!user) return;
    if (initialized.current.userId !== user.id) {
      initialized.current = {
        userId: user.id,
        email: false,
        name: false,
        phone: false,
      };
    }
    const fields = initialized.current;

    const updates: Partial<ContactValues> = {};
    if (customerEmail) fields.email = true;
    if (!fields.email && user.email) {
      updates.customerEmail = user.email;
      fields.email = true;
    }

    // A partial checkout name may belong to someone other than the signed-in user.
    if (firstName || lastName) fields.name = true;
    if (!fields.name) {
      const profileFirstName = readMetadataString(user, 'first_name');
      const profileLastName = readMetadataString(user, 'last_name');
      if (profileFirstName || profileLastName) {
        updates.firstName = profileFirstName || '';
        updates.lastName = profileLastName || '';
        fields.name = true;
      } else {
        const profileName =
          readMetadataString(user, 'full_name') ||
          readMetadataString(user, 'name');
        if (profileName) {
          const [profileFirst, ...profileRest] = profileName.split(' ');
          updates.firstName = profileFirst || '';
          updates.lastName = profileRest.join(' ') || '';
          fields.name = true;
        }
      }
    }

    const profilePhone = readMetadataString(user, 'phone');
    if (customerPhone) fields.phone = true;
    if (!fields.phone && profilePhone) {
      updates.customerPhone = profilePhone;
      fields.phone = true;
    }

    if (Object.keys(updates).length > 0) {
      setFields(updates);
    }
  }, [customerEmail, customerPhone, firstName, lastName, setFields, user]);
}
