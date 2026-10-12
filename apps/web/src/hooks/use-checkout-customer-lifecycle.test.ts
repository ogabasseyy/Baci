import type { User as SupabaseUser } from '@supabase/supabase-js';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useForm } from 'react-hook-form';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type CheckoutShippingValues,
  useCheckoutCustomerLifecycle,
} from './use-checkout-customer-lifecycle';

const { getUser } = vi.hoisted(() => ({ getUser: vi.fn() }));
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ auth: { getUser } }),
}));

const signedInUser = {
  id: 'user-1',
  email: 'buyer@example.com',
  user_metadata: {},
} as SupabaseUser;

function makeUser(userMetadata: Record<string, unknown> = {}) {
  return { ...signedInUser, user_metadata: userMetadata } as SupabaseUser;
}

const shippingDefaults: CheckoutShippingValues = {
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  address: '',
  city: '',
  state: '',
};

function setupLifecycle(merchantSlug: string | null = 'store') {
  return renderHook(() => {
    const form = useForm<CheckoutShippingValues>({
      defaultValues: shippingDefaults,
    });
    const lifecycle = useCheckoutCustomerLifecycle(merchantSlug, form.setValue);
    return { ...lifecycle, form };
  });
}

describe('useCheckoutCustomerLifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUser.mockResolvedValue({ data: { user: null } });
    vi.stubGlobal('fetch', vi.fn());
  });

  it('loads the signed-in customer before ending initial loading', async () => {
    getUser.mockResolvedValue({ data: { user: signedInUser } });
    vi.mocked(fetch).mockResolvedValue({
      json: async () => ({
        authenticated: true,
        customer: {
          first_name: 'Ada',
          last_name: 'Lovelace',
          email: 'buyer@example.com',
          phone: '+2348012345678',
          saved_addresses: [
            {
              first_name: 'Ada',
              last_name: 'Lovelace',
              full_name: 'Grace Hopper',
              phone: '+2348098765432',
              address: '12 Broad Street',
              city: 'Lagos',
              state: 'Lagos',
              is_default: true,
            },
          ],
        },
      }),
    } as Response);

    const { result } = setupLifecycle();
    await waitFor(() => expect(result.current.pageLoading).toBe(false));

    expect(result.current.step).toBe(1);
    expect(fetch).toHaveBeenCalledWith(
      '/api/storefront/auth/session?merchantSlug=store'
    );
    expect(result.current.form.getValues()).toEqual({
      firstName: 'Grace',
      lastName: 'Hopper',
      email: 'buyer@example.com',
      phone: '+2348098765432',
      address: '12 Broad Street',
      city: 'Lagos',
      state: 'Lagos',
    });
  });

  it('uses profile metadata when the merchant has no customer record', async () => {
    getUser.mockResolvedValue({
      data: { user: makeUser({ full_name: 'Ada Byron' }) },
    });
    const { result } = setupLifecycle(null);

    await waitFor(() => expect(result.current.pageLoading).toBe(false));

    expect(fetch).not.toHaveBeenCalled();
    expect(result.current.step).toBe(1);
    expect(result.current.form.getValues()).toMatchObject({
      firstName: 'Ada',
      lastName: 'Byron',
      email: 'buyer@example.com',
    });
  });

  it('keeps signed-in email when user metadata is absent', async () => {
    const userWithoutMetadata = {
      ...signedInUser,
      user_metadata: null,
    } as unknown as SupabaseUser;
    getUser.mockResolvedValue({ data: { user: userWithoutMetadata } });
    const { result } = setupLifecycle(null);

    await waitFor(() => expect(result.current.pageLoading).toBe(false));

    expect(result.current.form.getValues()).toMatchObject({
      firstName: '',
      lastName: '',
      email: 'buyer@example.com',
    });
  });

  it('completes session loading when customer lookup fails', async () => {
    getUser.mockResolvedValue({ data: { user: signedInUser } });
    vi.mocked(fetch).mockRejectedValue(new Error('offline'));
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    const { result } = setupLifecycle();

    await waitFor(() => expect(result.current.pageLoading).toBe(false));

    expect(result.current.step).toBe(1);
    expect(result.current.form.getValues('email')).toBe('buyer@example.com');
    expect(consoleError).toHaveBeenCalledWith(
      'Failed to fetch customer data:',
      expect.any(Error)
    );
    consoleError.mockRestore();
  });

  it('clears the loading gate when identity lookup rejects', async () => {
    getUser.mockRejectedValue(new Error('session unavailable'));
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    const { result } = setupLifecycle();
    await waitFor(() => expect(result.current.pageLoading).toBe(false));

    expect(result.current.step).toBe(0);
    expect(fetch).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledWith(
      'Failed to load checkout identity:',
      expect.any(Error)
    );
    consoleError.mockRestore();
  });

  it('enters guest shipping without a session and accepts later auth success', async () => {
    const { result } = setupLifecycle();
    await waitFor(() => expect(result.current.pageLoading).toBe(false));
    expect(result.current.form.getValues()).toEqual({
      firstName: '',
      lastName: '',
      email: '',
      phone: '',
      address: '',
      city: '',
      state: '',
    });

    act(() => result.current.handleGuestCheckout());
    expect(result.current.step).toBe(1);
    expect(result.current.isGuestCheckout).toBe(true);

    act(() => result.current.handleAuthSuccess(signedInUser));
    expect(result.current.step).toBe(1);
    expect(result.current.isGuestCheckout).toBe(false);
    await waitFor(() =>
      expect(result.current.form.getValues('email')).toBe('buyer@example.com')
    );
  });

  it('clears the previous merchant customer when a slug change yields none', async () => {
    getUser.mockResolvedValue({
      data: { user: makeUser({ first_name: 'Meta' }) },
    });
    const customerA = {
      first_name: 'Ada',
      last_name: 'Lovelace',
      email: 'buyer@example.com',
      phone: '+2348012345678',
      saved_addresses: [
        {
          first_name: 'Ada',
          last_name: 'Lovelace',
          phone: '+2348098765432',
          address: '12 Broad Street',
          city: 'Lagos',
          state: 'Lagos',
          is_default: true,
        },
      ],
    };
    vi.mocked(fetch).mockImplementation(
      async (url) =>
        ({
          json: async () =>
            String(url).includes('store-b')
              ? { authenticated: false }
              : { authenticated: true, customer: customerA },
        }) as Response
    );

    const { result, rerender } = renderHook(
      ({ slug }: { slug: string }) => {
        const form = useForm<CheckoutShippingValues>({
          defaultValues: shippingDefaults,
        });
        const lifecycle = useCheckoutCustomerLifecycle(slug, form.setValue);
        return { ...lifecycle, form };
      },
      { initialProps: { slug: 'store-a' } }
    );
    await waitFor(() => expect(result.current.pageLoading).toBe(false));
    expect(result.current.form.getValues('firstName')).toBe('Ada');
    expect(result.current.form.getValues('address')).toBe('12 Broad Street');

    rerender({ slug: 'store-b' });

    await waitFor(() =>
      expect(result.current.form.getValues('firstName')).toBe('Meta')
    );
    // Merchant A's saved-address prefill must not leak into merchant B's
    // form: metadata supplies only first_name, the rest revert to blank.
    expect(result.current.form.getValues()).toMatchObject({
      firstName: 'Meta',
      lastName: '',
      phone: '',
      address: '',
      city: '',
      state: '',
    });
  });

  it('drops the previous customer when auth succeeds without one', async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    const { result } = setupLifecycle();
    await waitFor(() => expect(result.current.pageLoading).toBe(false));

    const customerA = {
      first_name: 'Ada',
      last_name: 'Lovelace',
      email: 'buyer@example.com',
    };
    act(() => result.current.handleAuthSuccess(signedInUser, customerA));
    expect(result.current.form.getValues('firstName')).toBe('Ada');

    act(() =>
      result.current.handleAuthSuccess(makeUser({ first_name: 'Meta' }))
    );

    await waitFor(() =>
      expect(result.current.form.getValues('firstName')).toBe('Meta')
    );
  });
});
