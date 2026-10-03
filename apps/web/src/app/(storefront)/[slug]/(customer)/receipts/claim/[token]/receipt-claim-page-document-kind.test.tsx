import { render, screen } from '@testing-library/react';
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

describe('ReceiptClaimPageClient document kind', () => {
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

  it('labels invoice claim previews as invoices, not receipts', () => {
    renderClient({
      initialClaim: { ...preview, documentKind: 'invoice' as const },
    });

    expect(screen.getByText('Device invoices')).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Sign in to claim invoice' })
    ).toBeInTheDocument();
    expect(screen.queryByText('Device receipts')).not.toBeInTheDocument();
  });

  it('labels proforma claim previews as proforma invoices', () => {
    renderClient({
      initialClaim: { ...preview, documentKind: 'proforma_invoice' as const },
    });

    expect(screen.getByText('Device proforma invoices')).toBeInTheDocument();
    expect(screen.queryByText('Device receipts')).not.toBeInTheDocument();
  });

  it('labels legacy claims without a kind neutrally, not as receipts', () => {
    renderClient({
      initialClaim: { ...preview, documentKind: 'unknown' as const },
    });

    expect(screen.getByText('Device documents')).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Sign in to claim document' })
    ).toBeInTheDocument();
    expect(screen.queryByText('Device receipts')).not.toBeInTheDocument();
  });

  it('surfaces the verify-email guidance when the account is unverified', async () => {
    mockUseCustomerAuth.mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
    });
    mockFetchWithCsrf.mockResolvedValue(
      createJsonResponse(
        {
          code: 'EMAIL_UNVERIFIED',
          error: 'Verify your email address before claiming this receipt',
          success: false,
        },
        { status: 403 }
      )
    );

    renderClient();

    expect(
      await screen.findByText(
        'Verify your email address before claiming this receipt'
      )
    ).toBeInTheDocument();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('shows initial server errors and does not redeem', () => {
    mockUseCustomerAuth.mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
    });

    renderClient({
      initialClaim: null,
      initialError: 'Receipt claim link has expired',
    });

    expect(
      screen.getByText('Receipt claim link has expired')
    ).toBeInTheDocument();
    expect(mockFetchWithCsrf).not.toHaveBeenCalled();
  });
});
