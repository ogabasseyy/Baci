import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCustomerSession } from './use-customer-session';

describe('useCustomerSession', () => {
  const fetchMock = vi.fn();
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    vi.unstubAllGlobals();
  });

  function renderSession(
    overrides: {
      showAccount?: boolean;
      merchantSlug?: string;
      isPreview?: boolean;
    } = {}
  ) {
    return renderHook(() =>
      useCustomerSession({
        showAccount: true,
        merchantSlug: 'ogabassey',
        isPreview: false,
        ...overrides,
      })
    );
  }

  it('starts unsigned in and fills the session from a successful read', async () => {
    fetchMock.mockResolvedValueOnce({
      json: () =>
        Promise.resolve({
          authenticated: true,
          customer: {
            first_name: 'Ada',
            last_name: 'Obi',
            email: 'ada@example.com',
          },
        }),
    });

    const { result } = renderSession();

    expect(result.current.customerSession).toBeNull();

    await waitFor(() => {
      expect(result.current.customerSession).toEqual({
        authenticated: true,
        customer: {
          first_name: 'Ada',
          last_name: 'Obi',
          email: 'ada@example.com',
        },
      });
    });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/storefront/auth/session?merchantSlug=ogabassey'
    );
  });

  it('skips the session read when account UI, slug, or live mode is missing', () => {
    renderSession({ showAccount: false });
    renderSession({ merchantSlug: undefined });
    renderSession({ isPreview: true });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('degrades to signed out when the session read rejects', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network down'));

    const { result } = renderSession();

    await waitFor(() => {
      expect(result.current.customerSession).toEqual({
        authenticated: false,
        customer: null,
      });
    });
  });

  it('clears the session and leaves the storefront on logout', async () => {
    fetchMock
      .mockResolvedValueOnce({
        json: () =>
          Promise.resolve({
            authenticated: true,
            customer: {
              first_name: 'Ada',
              last_name: 'Obi',
              email: 'ada@example.com',
            },
          }),
      })
      .mockResolvedValueOnce({});
    const location = { href: 'https://ogabassey.com/' };
    vi.stubGlobal('location', location);

    const { result } = renderSession();

    await waitFor(() => {
      expect(result.current.customerSession?.authenticated).toBe(true);
    });

    await act(async () => {
      await result.current.handleLogout();
    });

    expect(fetchMock).toHaveBeenLastCalledWith('/api/storefront/auth/logout', {
      method: 'POST',
    });
    expect(result.current.customerSession).toEqual({
      authenticated: false,
      customer: null,
    });
    expect(location.href).toBe('/');
  });

  it('keeps the session when logout fails', async () => {
    fetchMock
      .mockResolvedValueOnce({
        json: () =>
          Promise.resolve({
            authenticated: true,
            customer: {
              first_name: 'Ada',
              last_name: 'Obi',
              email: 'ada@example.com',
            },
          }),
      })
      .mockRejectedValueOnce(new Error('network down'));

    const { result } = renderSession();

    await waitFor(() => {
      expect(result.current.customerSession?.authenticated).toBe(true);
    });

    await act(async () => {
      await result.current.handleLogout();
    });

    expect(result.current.customerSession?.authenticated).toBe(true);
    expect(consoleErrorSpy).toHaveBeenCalledOnce();
  });
});
