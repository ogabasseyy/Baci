import type { User } from '@supabase/supabase-js';
import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useCheckoutCustomerPrefill } from './use-checkout-customer-prefill';

const userWithMetadata = (
  userMetadata: User['user_metadata'],
  email = 'ada@example.com'
): User => ({
  id: 'customer-1',
  aud: 'authenticated',
  role: 'authenticated',
  email,
  app_metadata: { provider: 'email', providers: ['email'] },
  user_metadata: userMetadata,
  created_at: '2026-01-01T00:00:00Z',
});

describe('useCheckoutCustomerPrefill', () => {
  it('prefills details that arrive later for the same signed-in customer', async () => {
    const setFields = vi.fn();
    const values = {
      customerEmail: '',
      customerPhone: '',
      firstName: '',
      lastName: '',
    };
    const { rerender } = renderHook(
      ({ user }) => useCheckoutCustomerPrefill({ user, values, setFields }),
      { initialProps: { user: userWithMetadata({}, '') } }
    );
    expect(setFields).not.toHaveBeenCalled();
    rerender({
      user: userWithMetadata({ first_name: 'Ada', phone: '08012345678' }),
    });
    await waitFor(() =>
      expect(setFields).toHaveBeenCalledWith({
        customerEmail: 'ada@example.com',
        customerPhone: '08012345678',
        firstName: 'Ada',
        lastName: '',
      })
    );
  });

  it('prefills again after the same customer signs out and back in', async () => {
    const setFields = vi.fn();
    const user = userWithMetadata({});
    const values = {
      customerEmail: '',
      customerPhone: '',
      firstName: '',
      lastName: '',
    };
    const { rerender } = renderHook(
      ({ signedIn }: { signedIn: User | null }) =>
        useCheckoutCustomerPrefill({ user: signedIn, values, setFields }),
      { initialProps: { signedIn: user } }
    );
    await waitFor(() => expect(setFields).toHaveBeenCalledTimes(1));
    rerender({ signedIn: null });
    rerender({ signedIn: user });
    await waitFor(() => expect(setFields).toHaveBeenCalledTimes(2));
  });

  it('does not fill a phone number edited and cleared before profile data arrives', async () => {
    const setFields = vi.fn();
    const user = userWithMetadata({});
    const initial = {
      customerEmail: '',
      customerPhone: '',
      firstName: '',
      lastName: '',
    };
    const { rerender } = renderHook(
      ({ profile, values }) =>
        useCheckoutCustomerPrefill({ user: profile, values, setFields }),
      { initialProps: { profile: user, values: initial } }
    );
    await waitFor(() => expect(setFields).toHaveBeenCalledTimes(1));
    rerender({
      profile: user,
      values: {
        ...initial,
        customerEmail: 'ada@example.com',
        customerPhone: '08',
      },
    });
    rerender({
      profile: userWithMetadata({ phone: '08012345678' }),
      values: { ...initial, customerEmail: 'ada@example.com' },
    });
    expect(setFields).toHaveBeenCalledTimes(1);
  });

  it('does not refill fields cleared after the customer was prefilled', async () => {
    const setFields = vi.fn();
    const user = userWithMetadata({
      first_name: 'Ada',
      last_name: 'Lovelace',
      phone: '08012345678',
    });
    const initial = {
      customerEmail: '',
      customerPhone: '',
      firstName: '',
      lastName: '',
    };
    const { rerender } = renderHook(
      ({ values }) => useCheckoutCustomerPrefill({ user, values, setFields }),
      { initialProps: { values: initial } }
    );
    await waitFor(() => expect(setFields).toHaveBeenCalledTimes(1));
    rerender({
      values: {
        customerEmail: 'ada@example.com',
        customerPhone: '08012345678',
        firstName: 'Ada',
        lastName: 'Lovelace',
      },
    });
    rerender({
      values: {
        customerEmail: '',
        customerPhone: '',
        firstName: '',
        lastName: '',
      },
    });
    expect(setFields).toHaveBeenCalledTimes(1);
  });

  it('prefills when a different customer signs in', async () => {
    const setFields = vi.fn();
    const values = {
      customerEmail: '',
      customerPhone: '',
      firstName: '',
      lastName: '',
    };
    const first = userWithMetadata({});
    const second = {
      ...userWithMetadata({}, 'other@example.com'),
      id: 'customer-2',
    };
    const { rerender } = renderHook(
      ({ user }) => useCheckoutCustomerPrefill({ user, values, setFields }),
      { initialProps: { user: first } }
    );
    rerender({ user: second });
    await waitFor(() =>
      expect(setFields).toHaveBeenLastCalledWith({
        customerEmail: 'other@example.com',
      })
    );
  });
  it('prefills blank contact fields from first and last name metadata', async () => {
    const setFields = vi.fn();
    const user: User | null = userWithMetadata({
      first_name: 'Ada',
      last_name: 'Lovelace',
      full_name: 'Fallback Name',
      phone: '08012345678',
    });
    const values = {
      customerEmail: '',
      customerPhone: '',
      firstName: '',
      lastName: '',
    };

    renderHook(() => useCheckoutCustomerPrefill({ user, values, setFields }));

    await waitFor(() =>
      expect(setFields).toHaveBeenCalledWith({
        customerEmail: 'ada@example.com',
        customerPhone: '08012345678',
        firstName: 'Ada',
        lastName: 'Lovelace',
      })
    );
  });

  it('uses full_name before name when separate names are absent', async () => {
    const setFields = vi.fn();
    const values = {
      customerEmail: '',
      customerPhone: '',
      firstName: '',
      lastName: '',
    };
    const user = userWithMetadata({
      full_name: 'Ada Byron Lovelace',
      name: 'Ignored',
    });

    renderHook(() => useCheckoutCustomerPrefill({ user, values, setFields }));

    await waitFor(() =>
      expect(setFields).toHaveBeenCalledWith({
        customerEmail: 'ada@example.com',
        firstName: 'Ada',
        lastName: 'Byron Lovelace',
      })
    );
  });

  it('preserves persisted contact values, including a partially completed name', async () => {
    const setFields = vi.fn();
    const values = {
      customerEmail: '',
      customerPhone: '08000000000',
      firstName: 'Shopper',
      lastName: '',
    };
    const user: User | null = userWithMetadata({
      first_name: 'Profile',
      last_name: 'Name',
      phone: '08099999999',
    });

    renderHook(() => useCheckoutCustomerPrefill({ user, values, setFields }));

    await waitFor(() =>
      expect(setFields).toHaveBeenCalledWith({
        customerEmail: 'ada@example.com',
      })
    );
  });

  it('falls back to the legacy name key when full_name is empty', async () => {
    const setFields = vi.fn();
    const user = userWithMetadata({ full_name: '', name: 'Ada Lovelace' }, '');
    const values = {
      customerEmail: '',
      customerPhone: '',
      firstName: '',
      lastName: '',
    };

    renderHook(() => useCheckoutCustomerPrefill({ user, values, setFields }));

    await waitFor(() =>
      expect(setFields).toHaveBeenCalledWith({
        firstName: 'Ada',
        lastName: 'Lovelace',
      })
    );
  });

  it('fills the email when profile metadata is missing', async () => {
    const setFields = vi.fn();
    const user = {
      ...userWithMetadata({}),
      user_metadata: undefined,
    } as unknown as User;
    const values = {
      customerEmail: '',
      customerPhone: '',
      firstName: '',
      lastName: '',
    };

    renderHook(() => useCheckoutCustomerPrefill({ user, values, setFields }));

    await waitFor(() =>
      expect(setFields).toHaveBeenCalledWith({
        customerEmail: 'ada@example.com',
      })
    );
  });
});
