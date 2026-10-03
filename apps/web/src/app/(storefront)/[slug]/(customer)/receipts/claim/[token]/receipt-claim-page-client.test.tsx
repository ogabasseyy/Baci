import { render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readReceiptClaimAppDownloadToken } from '@/lib/import-notifications/receipt-claim-app-download-storage';
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

describe('ReceiptClaimPageClient', () => {
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

  it('shows the personalized preview and routes guests to login with a return URL', () => {
    renderClient({ initialEmailHint: 'customer@example.com' });

    expect(screen.getByText('Welcome Bassey John')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Your Ogabassey purchase is ready to link to your account.'
      )
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/moved your receipt to/i)
    ).not.toBeInTheDocument();
    expect(screen.getByText('iPhone 16 Pro Max')).toBeInTheDocument();
    expect(screen.getByText('2 x AirPods Pro')).toBeInTheDocument();

    expect(
      screen.getByRole('link', { name: 'Sign in to claim receipt' })
    ).toHaveAttribute(
      'href',
      '/account/login?redirect=%2Freceipts%2Fclaim%2Fclaim-token&email=customer%40example.com'
    );
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('does not show Ogabassey app links on other merchant claim pages', () => {
    renderClient();

    expect(
      screen.queryByRole('link', { name: /app store/i })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: /google play/i })
    ).not.toBeInTheDocument();
  });

  it('shows Ogabassey app links on Ogabassey claim pages', () => {
    mockUseMerchant.mockReturnValue({
      basePath: '/ogabassey',
      loading: false,
      merchant: { slug: 'ogabassey' },
    });

    renderClient();

    expect(
      screen.getByRole('link', { name: /google play/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: /app store/i })
    ).toBeInTheDocument();
  });

  it('redeems the claim and sends authenticated customers to receipts', async () => {
    mockUseCustomerAuth.mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
    });
    mockUseMerchant.mockReturnValue({
      basePath: '/ogabassey',
      loading: false,
    });

    renderClient();

    await waitFor(() => {
      expect(mockFetchWithCsrf).toHaveBeenCalledWith(
        '/api/storefront/receipts/claims/claim-token',
        { method: 'POST' }
      );
    });
    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith(
        '/ogabassey/receipts?receiptClaimed=1'
      );
    });
    expect(readReceiptClaimAppDownloadToken()).toBe('claim-token');
  });

  it('keeps the redemption request active after showing the claiming state', async () => {
    mockUseCustomerAuth.mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
    });
    mockUseMerchant.mockReturnValue({
      basePath: '/ogabassey',
      loading: false,
    });
    const redemption = createDeferred<Response>();
    mockFetchWithCsrf.mockReturnValue(redemption.promise);

    renderClient();

    await waitFor(() => {
      expect(mockFetchWithCsrf).toHaveBeenCalledWith(
        '/api/storefront/receipts/claims/claim-token',
        { method: 'POST' }
      );
    });
    expect(await screen.findByText('Claiming receipt...')).toBeInTheDocument();

    redemption.resolve(
      createJsonResponse({ redirectPath: '/receipts', success: true })
    );

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith(
        '/ogabassey/receipts?receiptClaimed=1'
      );
    });
  });

  it('does not redeem an already-claimed receipt link', () => {
    mockUseCustomerAuth.mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
    });

    renderClient({
      initialClaim: {
        ...preview,
        claimed: true,
      },
    });

    expect(screen.getByText('Welcome Bassey John')).toBeInTheDocument();
    expect(
      screen.getByText(
        'This receipt link has already been claimed. You can view it from the receipts panel.'
      )
    ).toBeInTheDocument();
    expect(mockFetchWithCsrf).not.toHaveBeenCalled();

    expect(screen.getByRole('link', { name: 'View receipts' })).toHaveAttribute(
      'href',
      '/receipts'
    );
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('shows an error and does not navigate when redemption fails', async () => {
    mockUseCustomerAuth.mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
    });
    mockFetchWithCsrf.mockResolvedValue(
      createJsonResponse(
        {
          error:
            'Sign in with the email address that received this receipt link',
          success: false,
        },
        { status: 403 }
      )
    );

    renderClient();

    expect(
      await screen.findByText(
        'Sign in with the email address that received this receipt link'
      )
    ).toBeInTheDocument();
    expect(mockPush).not.toHaveBeenCalled();
  });
});
