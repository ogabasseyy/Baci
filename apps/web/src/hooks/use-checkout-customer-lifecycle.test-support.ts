import type { User as SupabaseUser } from '@supabase/supabase-js';
import { renderHook } from '@testing-library/react';
import { useForm } from 'react-hook-form';
import {
  type CheckoutShippingValues,
  useCheckoutCustomerLifecycle,
} from './use-checkout-customer-lifecycle';

export const signedInUser = {
  id: 'user-1',
  email: 'buyer@example.com',
  user_metadata: {},
} as SupabaseUser;

export function makeUser(userMetadata: Record<string, unknown> = {}) {
  return { ...signedInUser, user_metadata: userMetadata } as SupabaseUser;
}

export const shippingDefaults: CheckoutShippingValues = {
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  address: '',
  city: '',
  state: '',
};

function useLifecycleHarness(merchantSlug: string | null) {
  const form = useForm<CheckoutShippingValues>({
    defaultValues: shippingDefaults,
  });
  const lifecycle = useCheckoutCustomerLifecycle(
    merchantSlug,
    form.setValue,
    form.getValues
  );
  return { ...lifecycle, form };
}

export function setupLifecycle(merchantSlug: string | null = 'store') {
  return renderHook(() => useLifecycleHarness(merchantSlug));
}

export function setupLifecycleWithSlug(initialSlug: string) {
  return renderHook(({ slug }: { slug: string }) => useLifecycleHarness(slug), {
    initialProps: { slug: initialSlug },
  });
}
