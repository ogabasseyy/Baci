import type { User as SupabaseUser } from '@supabase/supabase-js';
import { useEffect, useRef, useState } from 'react';
import type { UseFormGetValues, UseFormSetValue } from 'react-hook-form';
import { createClient } from '@/lib/supabase/client';

export interface CheckoutCustomerData {
  first_name: string;
  last_name: string;
  email: string;
  phone?: string;
  saved_addresses?: Array<{
    first_name: string;
    last_name: string;
    full_name?: string;
    phone: string;
    address: string;
    city: string;
    state: string;
    is_default?: boolean;
  }>;
}

export interface CheckoutShippingValues {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  state: string;
}

type CheckoutIdentity = {
  user: SupabaseUser | null;
  customerData: CheckoutCustomerData | null;
};

function setPrefillValue(
  setValue: UseFormSetValue<CheckoutShippingValues>,
  name: keyof CheckoutShippingValues,
  value: string
) {
  setValue(name, value, { shouldValidate: true, shouldDirty: true });
}

function applyCheckoutCustomerPrefill(
  { user, customerData }: CheckoutIdentity,
  setValue: UseFormSetValue<CheckoutShippingValues>
) {
  if (!user) return;

  setPrefillValue(setValue, 'email', user.email || '');

  if (customerData) {
    if (customerData.first_name) {
      setPrefillValue(setValue, 'firstName', customerData.first_name);
    }
    if (customerData.last_name) {
      setPrefillValue(setValue, 'lastName', customerData.last_name);
    }
    if (customerData.phone) {
      setPrefillValue(setValue, 'phone', customerData.phone);
    }

    const defaultAddress = customerData.saved_addresses?.find(
      (address) => address.is_default
    );
    if (!defaultAddress) return;

    setPrefillValue(setValue, 'address', defaultAddress.address);
    setPrefillValue(setValue, 'city', defaultAddress.city);
    setPrefillValue(setValue, 'state', defaultAddress.state);
    if (defaultAddress.phone) {
      setPrefillValue(setValue, 'phone', defaultAddress.phone);
    }
    if (defaultAddress.full_name) {
      const [firstName, ...lastName] = defaultAddress.full_name.split(' ');
      if (firstName) setPrefillValue(setValue, 'firstName', firstName);
      if (lastName.length > 0) {
        setPrefillValue(setValue, 'lastName', lastName.join(' '));
      }
    }
    return;
  }

  const metadata = user.user_metadata;
  if (!metadata) return;

  const firstName = metadata.first_name;
  const fullName = metadata.full_name;
  const name = metadata.name;

  if (typeof firstName === 'string' && firstName) {
    setPrefillValue(setValue, 'firstName', firstName);
  } else if (typeof fullName === 'string' && fullName) {
    const [first, ...rest] = fullName.split(' ');
    if (first) setPrefillValue(setValue, 'firstName', first);
    if (rest.length > 0) setPrefillValue(setValue, 'lastName', rest.join(' '));
  } else if (typeof name === 'string' && name) {
    const [first, ...rest] = name.split(' ');
    setPrefillValue(setValue, 'firstName', first || '');
    setPrefillValue(setValue, 'lastName', rest.join(' '));
  }

  if (typeof metadata.last_name === 'string' && metadata.last_name) {
    setPrefillValue(setValue, 'lastName', metadata.last_name);
  }
}

export function useCheckoutCustomerLifecycle(
  merchantSlug: string | null | undefined,
  setValue: UseFormSetValue<CheckoutShippingValues>,
  getValues: UseFormGetValues<CheckoutShippingValues>
) {
  const [pageLoading, setPageLoading] = useState(true);
  const [user, setUser] = useState<SupabaseUser | null>(null);
  const [customerData, setCustomerData] = useState<CheckoutCustomerData | null>(
    null
  );
  const [isGuestCheckout, setIsGuestCheckout] = useState(false);
  const [step, setStep] = useState(0);

  // Bumped by handleAuthSuccess so an in-flight identity reload cannot
  // overwrite a fresher OTP-verified user/customer when it resolves late.
  const identityGenerationRef = useRef(0);

  useEffect(() => {
    let active = true;
    const supabase = createClient();

    function clearIdentity() {
      // No verified identity for this merchant: drop the previous
      // merchant/user record so its prefill cannot leak, and return to
      // the auth gate for a fresh sign-in or guest choice.
      setUser(null);
      setCustomerData(null);
      setIsGuestCheckout(false);
      setStep(0);
    }

    async function loadIdentity() {
      const generation = identityGenerationRef.current;
      const isCurrent = () =>
        active && generation === identityGenerationRef.current;
      try {
        const { data } = await supabase.auth.getUser();
        if (!isCurrent()) return;

        if (!data.user) {
          clearIdentity();
          return;
        }
        setUser(data.user);
        // Default to no customer so a slug change (or a session that stops
        // returning one) clears the previous merchant's record instead of
        // re-applying it to the new merchant's form.
        let loadedCustomer: CheckoutCustomerData | null = null;
        if (merchantSlug) {
          try {
            const response = await fetch(
              `/api/storefront/auth/session?merchantSlug=${encodeURIComponent(merchantSlug)}`
            );
            const sessionData = await response.json();
            if (sessionData.authenticated && sessionData.customer) {
              loadedCustomer = sessionData.customer;
            }
          } catch (error) {
            console.error('Failed to fetch customer data:', error);
          }
        }
        if (!isCurrent()) return;
        setCustomerData(loadedCustomer);
        setStep(1);
      } catch (error) {
        console.error('Failed to load checkout identity:', error);
        // Fail closed on unknown auth state — but never clobber an OTP
        // success that landed while this load was in flight.
        if (isCurrent()) clearIdentity();
      } finally {
        // A getUser() rejection must not strand checkout on the loading gate.
        if (active) setPageLoading(false);
      }
    }

    void loadIdentity();
    return () => {
      active = false;
    };
  }, [merchantSlug]);

  // Values this hook wrote via prefill. On an identity switch, fields
  // still holding their applied value revert to blank so the previous
  // merchant/user record cannot leak into the new form; fields the
  // shopper edited since (current value differs) are left alone unless
  // the new identity's prefill writes them (prior overwrite behavior).
  const appliedPrefillRef = useRef<
    Partial<Record<keyof CheckoutShippingValues, string>>
  >({});

  useEffect(() => {
    const applied = appliedPrefillRef.current;
    const next: Partial<Record<keyof CheckoutShippingValues, string>> = {};
    for (const name of Object.keys(
      applied
    ) as (keyof CheckoutShippingValues)[]) {
      if (getValues(name) === applied[name]) {
        setValue(name, '', { shouldValidate: true, shouldDirty: true });
      }
    }
    const setAndTrack: UseFormSetValue<CheckoutShippingValues> = (
      name,
      value,
      options
    ) => {
      setValue(name, value, options);
      if (typeof value === 'string') next[name] = value;
    };
    applyCheckoutCustomerPrefill({ user, customerData }, setAndTrack);
    appliedPrefillRef.current = next;
  }, [user, customerData, setValue, getValues]);

  const handleAuthSuccess = (
    authenticatedUser: SupabaseUser,
    customer?: CheckoutCustomerData
  ) => {
    // Supersede any in-flight identity reload: its late resolution must
    // not overwrite these OTP-verified values.
    identityGenerationRef.current += 1;
    setUser(authenticatedUser);
    // An auth success without a customer record must drop the previous
    // record rather than pair it with the new user.
    setCustomerData(customer ?? null);
    setIsGuestCheckout(false);
    setStep(1);
  };

  const handleGuestCheckout = () => {
    setIsGuestCheckout(true);
    setStep(1);
  };

  return {
    handleAuthSuccess,
    handleGuestCheckout,
    isGuestCheckout,
    pageLoading,
    setStep,
    step,
  };
}
