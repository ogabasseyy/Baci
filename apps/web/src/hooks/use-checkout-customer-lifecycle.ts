import type { User as SupabaseUser } from '@supabase/supabase-js';
import { useEffect, useState } from 'react';
import type { UseFormSetValue } from 'react-hook-form';
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

export function applyCheckoutCustomerPrefill(
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
  setValue: UseFormSetValue<CheckoutShippingValues>
) {
  const [pageLoading, setPageLoading] = useState(true);
  const [user, setUser] = useState<SupabaseUser | null>(null);
  const [customerData, setCustomerData] = useState<CheckoutCustomerData | null>(
    null
  );
  const [isGuestCheckout, setIsGuestCheckout] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    let active = true;
    const supabase = createClient();

    async function loadIdentity() {
      const { data } = await supabase.auth.getUser();
      if (!active) return;

      if (data.user) {
        setUser(data.user);
        if (merchantSlug) {
          try {
            const response = await fetch(
              `/api/storefront/auth/session?merchantSlug=${encodeURIComponent(merchantSlug)}`
            );
            const sessionData = await response.json();
            if (active && sessionData.authenticated && sessionData.customer) {
              setCustomerData(sessionData.customer);
            }
          } catch (error) {
            console.error('Failed to fetch customer data:', error);
          }
        }
        if (active) setStep(1);
      }
      if (active) setPageLoading(false);
    }

    void loadIdentity();
    return () => {
      active = false;
    };
  }, [merchantSlug]);

  useEffect(() => {
    applyCheckoutCustomerPrefill({ user, customerData }, setValue);
  }, [user, customerData, setValue]);

  const handleAuthSuccess = (
    authenticatedUser: SupabaseUser,
    customer?: CheckoutCustomerData
  ) => {
    setUser(authenticatedUser);
    if (customer) setCustomerData(customer);
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
