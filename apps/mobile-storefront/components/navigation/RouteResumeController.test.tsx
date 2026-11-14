import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, render, waitFor } from '@testing-library/react-native';
import { registerRouteResumeDiagnosticTests } from '@/test-support/route-resume-controller-diagnostics-test-cases';
import {
  RouteResumeController,
  resetRouteResumeForTest,
  resetRouteResumeMemoryForTest,
} from './RouteResumeController';

let mockPathname = '/';
let mockSearchParams: Record<string, string | string[]> = {};
let mockNavigationState: { key: string } | undefined = { key: 'root' };
const mockReplace = jest.fn();
const mockRouteResumeStorage = new Map<string, string>();

jest.mock('expo-router', () => ({
  router: {
    replace: (href: unknown) => mockReplace(href),
  },
  useGlobalSearchParams: () => mockSearchParams,
  usePathname: () => mockPathname,
  useRootNavigationState: () => mockNavigationState,
}));

jest.mock('@/lib/storage', () => ({
  asyncStorage: {
    getItem: jest.fn((key: string) =>
      Promise.resolve(mockRouteResumeStorage.get(key) ?? null)
    ),
    removeItem: jest.fn((key: string) => {
      mockRouteResumeStorage.delete(key);
      return Promise.resolve();
    }),
    setItem: jest.fn((key: string, value: string) => {
      mockRouteResumeStorage.set(key, value);
      return Promise.resolve();
    }),
  },
}));

describe('RouteResumeController', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRouteResumeStorage.clear();
    resetRouteResumeForTest();
    mockPathname = '/';
    mockSearchParams = {};
    mockNavigationState = { key: 'root' };
  });

  registerRouteResumeDiagnosticTests({
    RouteResumeController,
    setRoute: (pathname, searchParams) => {
      mockPathname = pathname;
      mockSearchParams = searchParams;
    },
    mockReplace,
  });

  it('restores the last checkout route when the root navigator remounts at home', async () => {
    mockPathname = '/checkout';
    const firstRender = render(<RouteResumeController shouldResume={false} />);

    expect(mockReplace).not.toHaveBeenCalled();

    firstRender.unmount();
    mockPathname = '/';

    render(<RouteResumeController shouldResume />);

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/checkout');
    });
  });

  it.each([
    [
      'payment gateway',
      '/payment-gateway',
      {
        authorizationUrl: 'https://checkout.paystack.com/secret-session',
        orderId: 'order-123',
      },
      '/payment-gateway?authorizationUrl=https%3A%2F%2Fcheckout.paystack.com%2Fsecret-session&orderId=order-123',
    ],
    [
      'BNPL checkout',
      '/bnpl-checkout',
      {
        email: 'shopper@example.com',
        gateway: 'credit_direct',
        token: 'secret-token',
      },
      '/bnpl-checkout?email=shopper%40example.com&gateway=credit_direct&token=secret-token',
    ],
  ])('keeps %s resume data in memory without persisting sensitive params', async (_label, pathname, params, expectedHref) => {
    mockPathname = pathname;
    mockSearchParams = params;
    const firstRender = render(<RouteResumeController shouldResume={false} />);

    await act(async () => undefined);

    expect(mockRouteResumeStorage.has('route-resume-state')).toBe(false);

    firstRender.unmount();
    mockPathname = '/';
    mockSearchParams = {};

    render(<RouteResumeController shouldResume />);

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith(expectedHref);
    });
  });

  it('preserves repeated array search params when restoring', async () => {
    mockPathname = '/cart';
    mockSearchParams = {
      empty: [],
      items: ['item-1', 'item-2', 'item-3'],
    };
    const firstRender = render(<RouteResumeController shouldResume={false} />);

    firstRender.unmount();
    mockPathname = '/';
    mockSearchParams = {};

    render(<RouteResumeController shouldResume />);

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith(
        '/cart?items=item-1&items=item-2&items=item-3'
      );
    });
  });

  it('does not let an empty home boot disable a later root reset restore', async () => {
    const { rerender } = render(<RouteResumeController shouldResume />);

    expect(mockReplace).not.toHaveBeenCalled();

    mockPathname = '/checkout';
    rerender(<RouteResumeController shouldResume />);
    mockPathname = '/';
    mockNavigationState = { key: 'root-reset' };
    rerender(<RouteResumeController shouldResume />);

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/checkout');
    });
  });

  it('preserves the saved commerce route while auth routes are active', async () => {
    mockPathname = '/payment-gateway';
    mockSearchParams = {
      authorizationUrl: 'https://checkout.paystack.com/test',
      orderId: 'order-123',
    };
    const { rerender } = render(<RouteResumeController shouldResume />);

    mockPathname = '/auth/login';
    mockSearchParams = {
      returnTo: '/checkout',
    };
    rerender(<RouteResumeController shouldResume />);

    expect(mockReplace).not.toHaveBeenCalled();

    mockPathname = '/';
    mockSearchParams = {};
    mockNavigationState = { key: 'root-reset' };
    rerender(<RouteResumeController shouldResume />);

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith(
        '/payment-gateway?authorizationUrl=https%3A%2F%2Fcheckout.paystack.com%2Ftest&orderId=order-123'
      );
    });
  });

  it('restores a persisted checkout auth route after the JS runtime restarts at home', async () => {
    mockPathname = '/auth/login';
    mockSearchParams = {
      mode: 'otp',
      returnTo: '/checkout',
    };
    render(<RouteResumeController shouldResume />);

    await waitFor(() => {
      expect(mockRouteResumeStorage.get('route-resume-state')).toContain(
        '/auth/login?mode=otp&returnTo=%2Fcheckout'
      );
    });

    resetRouteResumeMemoryForTest();
    mockPathname = '/';
    mockSearchParams = {};
    mockNavigationState = { key: 'cold-root' };

    render(<RouteResumeController shouldResume />);

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith(
        '/auth/login?mode=otp&returnTo=%2Fcheckout'
      );
    });
  });

  it('ignores persisted sensitive payment routes from older app versions', async () => {
    mockRouteResumeStorage.set(
      'route-resume-state',
      JSON.stringify({
        href: '/payment-gateway?authorizationUrl=https%3A%2F%2Fcheckout.paystack.com%2Fsecret-session&orderId=order-123',
        navigationKey: null,
        savedAt: Date.now(),
      })
    );
    resetRouteResumeMemoryForTest();
    mockPathname = '/';

    render(<RouteResumeController shouldResume />);

    await act(async () => undefined);

    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('clears stale persisted safe routes when entering a sensitive payment route', async () => {
    mockRouteResumeStorage.set(
      'route-resume-state',
      JSON.stringify({
        href: '/checkout',
        navigationKey: 'root',
        savedAt: Date.now(),
      })
    );
    mockPathname = '/payment-gateway';
    mockSearchParams = {
      authorizationUrl: 'https://checkout.paystack.com/secret-session',
      orderId: 'order-123',
    };

    render(<RouteResumeController shouldResume />);

    await waitFor(() =>
      expect(mockRouteResumeStorage.has('route-resume-state')).toBe(false)
    );
  });

  it('does not restore non-commerce routes', async () => {
    mockPathname = '/auth/login';
    const firstRender = render(<RouteResumeController shouldResume={false} />);

    firstRender.unmount();
    mockPathname = '/';

    render(<RouteResumeController shouldResume />);

    await waitFor(() => expect(mockRouteResumeStorage.size).toBe(0));
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('clears the remembered route when the customer intentionally returns home', async () => {
    mockPathname = '/checkout';
    const { rerender } = render(<RouteResumeController shouldResume />);

    mockPathname = '/';
    rerender(<RouteResumeController shouldResume />);

    expect(mockReplace).not.toHaveBeenCalled();

    mockNavigationState = { key: 'root-reset' };
    rerender(<RouteResumeController shouldResume />);

    await waitFor(() =>
      expect(mockRouteResumeStorage.has('route-resume-state')).toBe(false)
    );
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('waits until root navigation is ready before restoring', async () => {
    mockPathname = '/cart';
    const firstRender = render(<RouteResumeController shouldResume={false} />);

    firstRender.unmount();
    mockPathname = '/';
    mockNavigationState = undefined;

    const restoreRender = render(<RouteResumeController shouldResume />);

    expect(mockReplace).not.toHaveBeenCalled();

    mockNavigationState = { key: 'root-reset' };
    restoreRender.rerender(<RouteResumeController shouldResume />);

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/cart');
    });
  });
});
