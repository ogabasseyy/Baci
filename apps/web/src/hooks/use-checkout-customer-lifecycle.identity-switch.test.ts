import { act, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  makeUser,
  setupLifecycle,
  setupLifecycleWithSlug,
  signedInUser,
} from './use-checkout-customer-lifecycle.test-support';

const { getUser } = vi.hoisted(() => ({ getUser: vi.fn() }));
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ auth: { getUser } }),
}));

describe('useCheckoutCustomerLifecycle identity switches', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUser.mockResolvedValue({ data: { user: null } });
    vi.stubGlobal('fetch', vi.fn());
  });

  it('clears the previous merchant customer when a slug change yields none', async () => {
    // Supabase returns a freshly parsed user object per getUser() call, so
    // each call gets its own reference: reusing one object would let React
    // bail out on the slug-change setUser and mask a stale user/customer
    // pairing in the prefill effect.
    getUser.mockImplementation(async () => ({
      data: { user: makeUser({ first_name: 'Meta' }) },
    }));
    // Hold the slug-change fetch open: an instant mock would flush the
    // whole reload in one batch, but real network latency lets the
    // intermediate render (new user, previous customer) commit first.
    let resolveStoreB!: (value: Response) => void;
    const storeBLoaded = new Promise<Response>((resolve) => {
      resolveStoreB = resolve;
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
    vi.mocked(fetch).mockImplementation(async (url) =>
      String(url).includes('store-b')
        ? storeBLoaded
        : ({
            json: async () => ({ authenticated: true, customer: customerA }),
          } as Response)
    );

    const { result, rerender } = setupLifecycleWithSlug('store-a');
    await waitFor(() => expect(result.current.pageLoading).toBe(false));
    expect(result.current.form.getValues('firstName')).toBe('Ada');
    expect(result.current.form.getValues('address')).toBe('12 Broad Street');

    // A shopper edit over prefill must survive the switch.
    act(() => {
      result.current.form.setValue('phone', '+9990001111', {
        shouldDirty: true,
      });
    });

    rerender({ slug: 'store-b' });
    // Let the getUser resolution commit while the session fetch is still
    // pending, reproducing the production render sequence.
    await waitFor(() => expect(getUser).toHaveBeenCalledTimes(2));
    await act(async () => {});

    await act(async () => {
      resolveStoreB({
        json: async () => ({ authenticated: false }),
      } as Response);
    });

    await waitFor(() =>
      expect(result.current.form.getValues('firstName')).toBe('Meta')
    );
    // Merchant A's saved-address prefill must not leak into merchant B's
    // form: metadata supplies only first_name, untouched prefill reverts
    // to blank, and the shopper-edited phone is preserved.
    expect(result.current.form.getValues()).toMatchObject({
      firstName: 'Meta',
      lastName: '',
      phone: '+9990001111',
      address: '',
      city: '',
      state: '',
    });
  });

  it('returns to the auth gate when a slug change finds no session', async () => {
    getUser
      .mockResolvedValueOnce({ data: { user: signedInUser } })
      .mockResolvedValue({ data: { user: null } });
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

    const { result, rerender } = setupLifecycleWithSlug('store-a');
    await waitFor(() => expect(result.current.pageLoading).toBe(false));
    expect(result.current.step).toBe(1);
    expect(result.current.form.getValues('address')).toBe('12 Broad Street');

    rerender({ slug: 'store-b' });

    await waitFor(() => expect(result.current.step).toBe(0));
    expect(result.current.form.getValues()).toMatchObject({
      email: '',
      firstName: '',
      lastName: '',
      phone: '',
      address: '',
      city: '',
      state: '',
    });
  });

  it('keeps an OTP auth success that lands during an identity reload', async () => {
    getUser.mockResolvedValue({
      data: { user: makeUser({ first_name: 'MetaB' }) },
    });
    let resolveSession!: (value: Response) => void;
    vi.mocked(fetch).mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          resolveSession = resolve;
        })
    );

    const { result } = setupLifecycle('store-b');
    await waitFor(() => expect(fetch).toHaveBeenCalled());

    const otpCustomer = {
      first_name: 'Otp',
      last_name: 'User',
      email: 'otp@example.com',
    };
    act(() => result.current.handleAuthSuccess(signedInUser, otpCustomer));
    expect(result.current.form.getValues('firstName')).toBe('Otp');

    // The session endpoint has not observed the just-verified session yet.
    resolveSession({
      json: async () => ({ authenticated: false }),
    } as Response);

    await waitFor(() => expect(result.current.pageLoading).toBe(false));
    expect(result.current.form.getValues('firstName')).toBe('Otp');
    expect(result.current.form.getValues('lastName')).toBe('User');
  });

  it('keeps guest checkout chosen while an identity reload is pending', async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    let resolveUser!: (value: Awaited<ReturnType<typeof getUser>>) => void;
    getUser.mockImplementationOnce(
      () =>
        new Promise<Awaited<ReturnType<typeof getUser>>>((resolve) => {
          resolveUser = resolve;
        })
    );

    const { result } = setupLifecycle('store-a');
    await waitFor(() => expect(getUser).toHaveBeenCalled());

    act(() => result.current.handleGuestCheckout());
    expect(result.current.step).toBe(1);
    expect(result.current.isGuestCheckout).toBe(true);

    resolveUser({ data: { user: null } });

    await waitFor(() => expect(result.current.pageLoading).toBe(false));
    expect(result.current.step).toBe(1);
    expect(result.current.isGuestCheckout).toBe(true);
  });

  it('gates rendering while a slug-change reload is pending', async () => {
    getUser.mockResolvedValue({ data: { user: signedInUser } });
    vi.mocked(fetch).mockResolvedValue({
      json: async () => ({ authenticated: false }),
    } as Response);

    const { result, rerender } = setupLifecycleWithSlug('store-a');
    await waitFor(() => expect(result.current.pageLoading).toBe(false));
    expect(result.current.step).toBe(1);

    let resolveUser!: (value: Awaited<ReturnType<typeof getUser>>) => void;
    getUser.mockImplementationOnce(
      () =>
        new Promise<Awaited<ReturnType<typeof getUser>>>((resolve) => {
          resolveUser = resolve;
        })
    );
    rerender({ slug: 'store-b' });

    expect(result.current.pageLoading).toBe(true);

    resolveUser({ data: { user: signedInUser } });
    await waitFor(() => expect(result.current.pageLoading).toBe(false));
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
