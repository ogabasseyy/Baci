import { act, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  setupLifecycle,
  signedInUser,
} from './use-checkout-customer-lifecycle.test-support';

const { getUser } = vi.hoisted(() => ({ getUser: vi.fn() }));
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ auth: { getUser } }),
}));

const customer = {
  email: 'fixture@example.test',
  saved_addresses: [
    {
      first_name: 'Test',
      last_name: 'Buyer',
      phone: '+2348031234567',
      address: '12 Broad Street',
      city: 'Lagos Island',
      state: 'Lagos',
      is_default: true,
    },
  ],
};

describe('saved-address pin invalidation', () => {
  beforeEach(() => {
    getUser.mockResolvedValue({ data: { user: null } });
    vi.stubGlobal('fetch', vi.fn());
  });

  it.each([
    'replace',
    'clear',
  ] as const)('clears a selected pin when identity prefill must %s the destination', async (operation) => {
    const { result } = setupLifecycle();
    await waitFor(() => expect(result.current.pageLoading).toBe(false));
    act(() => result.current.handleAuthSuccess(signedInUser, customer));
    act(() => {
      result.current.form.setValue('latitude', 6.454);
      result.current.form.setValue('longitude', 3.393);
    });
    const revision = result.current.addressRevision;
    act(() =>
      result.current.handleAuthSuccess(
        { ...signedInUser, id: 'next-user' },
        operation === 'replace'
          ? {
              ...customer,
              saved_addresses: [
                { ...customer.saved_addresses[0], city: 'Ikeja' },
              ],
            }
          : undefined
      )
    );
    expect(result.current.form.getValues()).toMatchObject({
      address: operation === 'replace' ? '12 Broad Street' : '',
      city: operation === 'replace' ? 'Ikeja' : '',
      latitude: null,
      longitude: null,
    });
    expect(result.current.addressRevision).toBeGreaterThan(revision);
  });
});
