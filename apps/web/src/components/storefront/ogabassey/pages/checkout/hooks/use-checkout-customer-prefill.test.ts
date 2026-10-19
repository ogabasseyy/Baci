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
