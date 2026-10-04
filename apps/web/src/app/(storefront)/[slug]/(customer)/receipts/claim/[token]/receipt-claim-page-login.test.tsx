import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ReceiptClaimPageClient from './receipt-claim-page-client';

const mockPush = vi.fn();
const mockRouter = { push: mockPush };
const mockFetchWithCsrf = vi.fn();
const mockUseCustomerAuth = vi.fn();
const mockUseMerchant = vi.fn();
const mockSearchParams = new URLSearchParams();

vi.mock('next/navigation', () => ({
  useRouter: () => mockRouter,
  useSearchParams: () => mockSearchParams,
}));

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    ...props
  }: {
    children: ReactNode;
    href: string;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock('@/contexts/customer-auth-context', () => ({
  useCustomerAuth: () => mockUseCustomerAuth(),
}));

vi.mock('@/hooks/use-merchant-client', () => ({
  useMerchant: () => mockUseMerchant(),
}));

vi.mock('@/lib/api-client', () => ({
  fetchWithCsrf: (...args: unknown[]) => mockFetchWithCsrf(...args),
}));

function createJsonResponse(body: unknown, init: ResponseInit = {}) {
  return {
    ok: init.status ? init.status < 400 : true,
    status: init.status ?? 200,
    json: async () => body,
  } as Response;
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return { promise, reject, resolve };
}

const preview = {
  claimed: false,
  customerName: 'Bassey John',
  devices: ['iPhone 16 Pro Max', '2 x AirPods Pro'],
  documentKind: 'receipt' as const,
  merchantName: 'Ogabassey',
};

function renderClient(
  props: Partial<Parameters<typeof ReceiptClaimPageClient>[0]> = {}
) {
  return render(
    <ReceiptClaimPageClient
      initialClaim={preview}
      initialEmailHint=""
      initialError={null}
      token="claim-token"
      {...props}
    />
  );
}

describe('ReceiptClaimPageClient guest login', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(createJsonResponse({ emailHint: '' }))
    );
    mockSearchParams.delete('email');
    mockUseCustomerAuth.mockReturnValue({
      isAuthenticated: false,
      isLoading: false,
    });
    mockUseMerchant.mockReturnValue({
      basePath: '',
      loading: false,
    });
    mockFetchWithCsrf.mockResolvedValue(
      createJsonResponse({ redirectPath: '/receipts', success: true })
    );
    window.sessionStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('prefers a sanitized legacy URL email hint when one is present', () => {
    mockSearchParams.set('email', '  UrlHint@Yahoo.CO.UK  ');

    renderClient({ initialEmailHint: 'server-hint@example.com' });

    expect(
      screen.getByRole('link', { name: 'Sign in to claim receipt' })
    ).toHaveAttribute(
      'href',
      '/account/login?redirect=%2Freceipts%2Fclaim%2Fclaim-token&email=urlhint%40yahoo.co.uk'
    );
  });

  it('does not append invalid email hints to login links', () => {
    mockSearchParams.set('email', 'https://evil.example');

    renderClient();

    expect(
      screen.getByRole('link', { name: 'Sign in to claim receipt' })
    ).toHaveAttribute(
      'href',
      '/account/login?redirect=%2Freceipts%2Fclaim%2Fclaim-token'
    );
  });

  it('records login-start activity when guests click the claim CTA', async () => {
    const user = userEvent.setup();

    renderClient({ initialEmailHint: 'customer@example.com' });

    await user.click(
      screen.getByRole('link', { name: 'Sign in to claim receipt' })
    );

    expect(mockFetchWithCsrf).toHaveBeenCalledWith(
      '/api/storefront/receipts/claims/claim-token/login-email',
      {
        cache: 'no-store',
        headers: { accept: 'application/json' },
        keepalive: true,
        method: 'POST',
      }
    );
    expect(mockPush).toHaveBeenCalledWith(
      '/account/login?redirect=%2Freceipts%2Fclaim%2Fclaim-token&email=customer%40example.com'
    );
  });

  it('does not double-record login-start tracking while navigation is pending', async () => {
    vi.useFakeTimers();
    const loginStart = createDeferred<Response>();
    mockFetchWithCsrf.mockReturnValue(loginStart.promise);

    renderClient();
    const link = screen.getByRole('link', { name: 'Sign in to claim receipt' });

    fireEvent.click(link, { button: 0 });
    fireEvent.click(link, { button: 0 });

    expect(mockFetchWithCsrf).toHaveBeenCalledTimes(1);
    expect(mockPush).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(750);

    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith(
      '/account/login?redirect=%2Freceipts%2Fclaim%2Fclaim-token'
    );

    loginStart.resolve(createJsonResponse({ success: true }));
  });

  it('routes to login after a short tracking window when login-start tracking stalls', async () => {
    vi.useFakeTimers();
    const loginStart = createDeferred<Response>();
    mockFetchWithCsrf.mockReturnValue(loginStart.promise);

    renderClient();

    fireEvent.click(
      screen.getByRole('link', { name: 'Sign in to claim receipt' }),
      { button: 0 }
    );

    expect(mockFetchWithCsrf).toHaveBeenCalledWith(
      '/api/storefront/receipts/claims/claim-token/login-email',
      expect.objectContaining({ method: 'POST' })
    );
    expect(mockPush).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(750);

    expect(mockPush).toHaveBeenCalledWith(
      '/account/login?redirect=%2Freceipts%2Fclaim%2Fclaim-token'
    );

    loginStart.resolve(createJsonResponse({ success: true }));
  });
});
