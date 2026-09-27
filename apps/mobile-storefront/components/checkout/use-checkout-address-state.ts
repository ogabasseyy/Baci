import type { User } from '@supabase/supabase-js';
import { useEffect, useRef, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { deriveCheckoutIdentity } from '@/lib/checkout-identity';
import type { ShippingAddressInput } from '@/lib/validation';
import { trackCheckoutRouteStarted } from '@/services/tiktok-checkout-route-tracking';
import type { Customer } from '@/stores/auth-store';
import type { CartItem } from '@/stores/cart-store';
import { isCheckoutContactComplete } from './checkout-contact-readiness';
import { isCheckoutAddressComplete } from './checkout-continue-readiness';
import {
  CHECKOUT_API_BASE_URL,
  CHECKOUT_MERCHANT_ID,
  shippingAddressResolver,
} from './checkout-screen.constants';
import { shouldAutoCollapseCheckoutContact } from './should-auto-collapse-checkout-contact';
import { useCheckoutSavedAddresses } from './use-checkout-saved-addresses';
import { useCheckoutShipping } from './use-checkout-shipping';

interface UseCheckoutAddressStateParams {
  analyticsEnabled?: boolean;
  customer: Customer | null;
  isAuthenticated: boolean;
  items: CartItem[];
  subtotal: number;
  user: User | null;
}

/**
 * Subscriber-line key: trailing 10 digits. Stored identity and display
 * input routinely carry different prefixes/spacing for the same line
 * (+2349169449282 vs +234 9169449282 vs 09169449282), and the settle
 * comparison must treat those as identical. Empty on either side never
 * matches, so a genuinely missing phone still blocks.
 */
function contactPhoneKey(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (!digits) return '';
  return digits.length >= 10 ? digits.slice(-10) : digits;
}

/**
 * Settle comparison must ignore display formatting (phone spacing/prefix,
 * email case/whitespace). Otherwise prefilled-but-valid contact never matches
 * the settled signature until the user edits a field and blurs, and Continue
 * stays stuck with nothing left to do.
 */
function contactSignature({
  email,
  firstName,
  lastName,
  phone,
}: {
  email: string;
  firstName: string;
  lastName: string;
  phone: string;
}): string {
  return [
    email.trim().toLowerCase(),
    firstName.trim(),
    lastName.trim(),
    contactPhoneKey(phone),
  ].join('\0');
}

export function useCheckoutAddressState({
  analyticsEnabled = true,
  customer,
  isAuthenticated,
  items,
  subtotal,
  user,
}: UseCheckoutAddressStateParams) {
  const hasTrackedStart = useRef(false);
  const wasContactComplete = useRef(false);
  const [saveDetails, setSaveDetails] = useState(false);
  const [accountPassword, setAccountPassword] = useState('');
  const checkoutIdentity = deriveCheckoutIdentity({ customer, user });
  const checkoutEmail = checkoutIdentity.email;
  const checkoutFirstName = checkoutIdentity.firstName;
  const checkoutLastName = checkoutIdentity.lastName;
  const checkoutPhone = checkoutIdentity.phone;
  const initialContactSignature = contactSignature({
    email: checkoutEmail,
    firstName: checkoutFirstName,
    lastName: checkoutLastName,
    phone: checkoutPhone,
  });
  const [settledContactSignature, setSettledContactSignature] = useState(
    initialContactSignature
  );

  const form = useForm<ShippingAddressInput>({
    resolver: shippingAddressResolver,
    defaultValues: {
      email: checkoutEmail,
      firstName: checkoutFirstName,
      lastName: checkoutLastName,
      phone: checkoutPhone,
      address: '',
      city: '',
      state: '',
      notes: '',
    },
    mode: 'onBlur',
    shouldUnregister: false,
  });
  const { control, getValues, reset, setValue } = form;
  // useWatch instead of watch(): watch() returns interior-mutable values that
  // force React Compiler to skip memoizing this hook (incompatible-library).
  const watchedState = useWatch({ control, name: 'state' });
  const watchedCity = useWatch({ control, name: 'city' });
  const watchedAddress = useWatch({ control, name: 'address' });
  const watchedPhone = useWatch({ control, name: 'phone' });
  const watchedFirstName = useWatch({ control, name: 'firstName' });
  const watchedLastName = useWatch({ control, name: 'lastName' });
  const watchedEmail = useWatch({ control, name: 'email' });
  const isAddressComplete = isCheckoutAddressComplete({
    email: watchedEmail,
    firstName: watchedFirstName,
    lastName: watchedLastName,
    phone: watchedPhone,
    address: watchedAddress,
    city: watchedCity,
    state: watchedState,
  });

  const shipping = useCheckoutShipping({
    apiBaseUrl: CHECKOUT_API_BASE_URL,
    customer,
    items,
    setValue,
    watchedAddress,
    watchedCity,
    watchedEmail,
    watchedFirstName,
    watchedLastName,
    watchedPhone,
    watchedState,
  });
  const hasInitialContactIdentity = Boolean(
    checkoutEmail && checkoutFirstName && checkoutLastName && checkoutPhone
  );
  const currentContactSignature = contactSignature({
    email: watchedEmail,
    firstName: watchedFirstName,
    lastName: watchedLastName,
    phone: watchedPhone,
  });
  const isContactSettled =
    currentContactSignature === settledContactSignature ||
    (hasInitialContactIdentity &&
      currentContactSignature === initialContactSignature);
  const isContactComplete =
    isContactSettled &&
    isCheckoutContactComplete({
      email: watchedEmail,
      firstName: watchedFirstName,
      lastName: watchedLastName,
      phone: watchedPhone,
    });
  const savedAddresses = useCheckoutSavedAddresses({
    customerId: customer?.id,
    hasInitialContactIdentity,
    isAuthenticated,
    merchantId: CHECKOUT_MERCHANT_ID,
    setCommittedAddress: shipping.setCommittedAddress,
    setValue,
    settleContactTo: ({ firstName, lastName, phone }) => {
      setSettledContactSignature(
        contactSignature({
          email: getValues('email'),
          firstName,
          lastName,
          phone,
        })
      );
    },
  });

  useEffect(() => {
    if (!isContactComplete) {
      savedAddresses.setIsContactCollapsed(false);
      return;
    }

    if (
      shouldAutoCollapseCheckoutContact({
        hasInitialContactIdentity,
        isContactComplete,
        isContactSettled,
        wasContactComplete: wasContactComplete.current,
      })
    ) {
      savedAddresses.setIsContactCollapsed(true);
      wasContactComplete.current = true;
    }
  }, [
    hasInitialContactIdentity,
    isContactComplete,
    isContactSettled,
    savedAddresses.setIsContactCollapsed,
  ]);

  useEffect(() => {
    if (analyticsEnabled && !hasTrackedStart.current && items.length > 0) {
      void trackCheckoutRouteStarted({ items, subtotal }).catch(() => {
        // Checkout analytics must not interrupt checkout entry.
      });
      hasTrackedStart.current = true;
    }
  }, [analyticsEnabled, items, subtotal]);

  useEffect(() => {
    if (!isAuthenticated) return;
    reset(
      {
        email: checkoutEmail,
        firstName: checkoutFirstName,
        lastName: checkoutLastName,
        phone: checkoutPhone,
        address: getValues('address'),
        city: getValues('city'),
        state: getValues('state'),
        notes: getValues('notes'),
      },
      { keepDirtyValues: true }
    );
  }, [
    checkoutEmail,
    checkoutFirstName,
    checkoutLastName,
    checkoutPhone,
    getValues,
    isAuthenticated,
    reset,
  ]);

  const currentContactSummary = `${watchedFirstName} ${watchedLastName}`.trim();
  const currentDeliverySummary = [watchedAddress, watchedCity, watchedState]
    .filter(Boolean)
    .join(', ');
  const openNewAddressEditor = () => {
    if (savedAddresses.selectedSavedAddressId) {
      setValue('address', '', { shouldValidate: false });
      setValue('city', '', { shouldValidate: false });
      setValue('state', '', { shouldValidate: false });
    }
    savedAddresses.openNewAddressEditor();
  };
  const settleContactEmail = () => {
    setSettledContactSignature(
      contactSignature({
        email: getValues('email'),
        firstName: getValues('firstName'),
        lastName: getValues('lastName'),
        phone: getValues('phone'),
      })
    );
  };

  return {
    accountPassword,
    currentContactSummary,
    currentDeliverySummary,
    form,
    hasContactIdentity: isContactComplete,
    isAddressComplete,
    openNewAddressEditor,
    saveDetails,
    savedAddresses,
    settleContactEmail,
    setAccountPassword,
    setSaveDetails,
    shipping,
    watchedCity,
    watchedEmail,
    watchedPhone,
    watchedState,
  };
}

export type CheckoutAddressState = ReturnType<typeof useCheckoutAddressState>;
