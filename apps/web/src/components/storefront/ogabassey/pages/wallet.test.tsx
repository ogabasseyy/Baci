import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OgabasseyV2Wallet } from './wallet';

const mockUseCustomerAuth = vi.hoisted(() => vi.fn());
const mockUseMerchantSafe = vi.hoisted(() => vi.fn());
const fundingPanelProps = vi.hoisted(
  () => ({ current: null }) as { current: Record<string, unknown> | null }
);
const usdtFundingPanelProps = vi.hoisted(
  () => ({ current: null }) as { current: Record<string, unknown> | null }
);

vi.mock('@/contexts/customer-auth-context', () => ({
  useCustomerAuth: mockUseCustomerAuth,
  useOptionalCustomerAuth: mockUseCustomerAuth,
}));

vi.mock('@/hooks/use-merchant-client', () => ({
  useMerchantSafe: mockUseMerchantSafe,
}));

vi.mock('../components/empty-state', () => ({
  EmptyState: () => <div data-testid="empty-state" />,
}));

vi.mock('../components/WalletFundingPanel', () => ({
  WalletFundingPanel: (props: Record<string, unknown>) => {
    fundingPanelProps.current = props;
    return <div data-testid="wallet-funding-panel" />;
  },
}));
vi.mock('../components/UsdtWalletFundingPanel', () => ({
  UsdtWalletFundingPanel: (props: Record<string, unknown>) => {
    usdtFundingPanelProps.current = props;
    return <div data-testid="usdt-wallet-funding-panel" />;
  },
}));

const fundingAccount = {
  accountName: 'OGB / JOHN DOE',
  accountNumber: '9012345678',
  bankName: 'Wema Bank',
  provider: 'paystack',
};

describe('OgabasseyV2Wallet', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fundingPanelProps.current = null;
    usdtFundingPanelProps.current = null;
    mockUseCustomerAuth.mockReturnValue({
      customer: { id: 'customer-1', phone: '08012345678' },
      isAuthenticated: true,
      isLoading: false,
      user: { id: 'user-1' },
    });
    mockUseMerchantSafe.mockReturnValue({ merchant: { slug: 'ogabassey' } });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        json: async () => ({
          balance: 2500,
          fundingAccount,
          requiresFundingAccountConsent: false,
          totalEarned: 2500,
          totalRedeemed: 0,
          transactions: [],
        }),
      })
    );
  });

  it('hides USDT funding when the server capability is disabled', async () => {
    render(<OgabasseyV2Wallet usdtWalletEnabled={false} />);

    await screen.findByText('₦2,500.00');
    expect(
      screen.queryByRole('button', { name: /fund usdt/i })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('usdt-wallet-funding-panel')
    ).not.toBeInTheDocument();
  });

  it('passes a redirected funding reference to the USDT panel', async () => {
    render(
      <OgabasseyV2Wallet
        initialShowUsdtFunding
        initialUsdtReference="wusdt_ref_123456"
        usdtWalletEnabled
      />
    );

    await screen.findByText('₦2,500.00');
    expect(usdtFundingPanelProps.current).toMatchObject({
      initialReference: 'wusdt_ref_123456',
    });
  });

  it('renders the fetched wallet balance', async () => {
    render(<OgabasseyV2Wallet />);

    expect(await screen.findByText('₦2,500.00')).toBeInTheDocument();
  });

  it('always shows an existing DVA as the wallet account number without any click', async () => {
    render(<OgabasseyV2Wallet />);

    await screen.findByText('₦2,500.00');

    expect(screen.getByTestId('wallet-funding-panel')).toBeInTheDocument();
    expect(fundingPanelProps.current).toMatchObject({
      account: fundingAccount,
      customerId: 'customer-1',
      merchantSlug: 'ogabassey',
      requiresConsent: false,
      surface: 'wallet_page',
    });
  });

  it('keeps the consent flow behind the Fund Wallet button when no account exists', async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValue({
      json: async () => ({
        balance: 0,
        fundingAccount: null,
        requiresFundingAccountConsent: true,
        totalEarned: 0,
        totalRedeemed: 0,
        transactions: [],
        walletDvaEnabled: true,
      }),
    } as Response);

    render(<OgabasseyV2Wallet />);

    await screen.findByText('₦0.00');
    expect(
      screen.queryByTestId('wallet-funding-panel')
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /fund wallet/i }));

    expect(screen.getByTestId('wallet-funding-panel')).toBeInTheDocument();
    expect(fundingPanelProps.current).toMatchObject({
      account: null,
      requiresConsent: true,
    });
  });

  it('opens the existing funding panel when reached from a funding deep link', async () => {
    vi.mocked(fetch).mockResolvedValue({
      json: async () => ({
        balance: 0,
        fundingAccount: null,
        requiresFundingAccountConsent: true,
        totalEarned: 0,
        totalRedeemed: 0,
        transactions: [],
        walletDvaEnabled: true,
      }),
    } as Response);

    render(<OgabasseyV2Wallet initialShowFunding />);

    await screen.findByText('₦0.00');

    expect(screen.getByTestId('wallet-funding-panel')).toBeInTheDocument();
    expect(fundingPanelProps.current).toMatchObject({
      account: null,
      requiresConsent: true,
    });
  });

  it('does not offer consent when the merchant has wallet DVAs disabled', async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValue({
      json: async () => ({
        balance: 0,
        fundingAccount: null,
        requiresFundingAccountConsent: true,
        totalEarned: 0,
        totalRedeemed: 0,
        transactions: [],
        walletDvaEnabled: false,
      }),
    } as Response);

    render(<OgabasseyV2Wallet />);

    await screen.findByText('₦0.00');
    await user.click(screen.getByRole('button', { name: /fund wallet/i }));

    // DVA disabled -> consent is withheld so the panel renders its
    // unavailable state instead of a create request that would 403.
    expect(fundingPanelProps.current).toMatchObject({
      account: null,
      requiresConsent: false,
    });
  });

  it('passes a missing phone through so the panel can collect it at point of need', async () => {
    const user = userEvent.setup();
    const updateCustomer = vi.fn().mockResolvedValue({ success: true });
    mockUseCustomerAuth.mockReturnValue({
      customer: { id: 'customer-1', phone: null },
      isAuthenticated: true,
      isLoading: false,
      updateCustomer,
      user: { id: 'user-1' },
    });
    vi.mocked(fetch).mockResolvedValue({
      json: async () => ({
        balance: 0,
        fundingAccount: null,
        requiresFundingAccountConsent: true,
        totalEarned: 0,
        totalRedeemed: 0,
        transactions: [],
        walletDvaEnabled: true,
      }),
    } as Response);

    render(<OgabasseyV2Wallet />);

    await screen.findByText('₦0.00');
    await user.click(screen.getByRole('button', { name: /fund wallet/i }));

    expect(fundingPanelProps.current).toMatchObject({
      account: null,
      customerPhone: null,
      requiresConsent: true,
    });
    const onUpdateCustomerPhone = fundingPanelProps.current
      ?.onUpdateCustomerPhone as (phone: string) => Promise<{
      success: boolean;
    }>;
    await expect(onUpdateCustomerPhone('08012345678')).resolves.toEqual({
      success: true,
    });
    expect(updateCustomer).toHaveBeenCalledWith({ phone: '08012345678' });
  });

  it('refetches the wallet when the funding panel requests a balance refresh', async () => {
    render(<OgabasseyV2Wallet />);

    await screen.findByText('₦2,500.00');

    const onRefreshBalance = fundingPanelProps.current
      ?.onRefreshBalance as () => void;
    onRefreshBalance();

    await waitFor(() => {
      expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
    });
  });

  it('drops the previous account number immediately on sign-out', async () => {
    const { rerender } = render(<OgabasseyV2Wallet />);

    // Existing DVA auto-shows for the signed-in customer.
    expect(await screen.findByText('₦2,500.00')).toBeInTheDocument();
    expect(screen.getByTestId('wallet-funding-panel')).toBeInTheDocument();

    // Same-tab sign-out: the reusable account number must not linger.
    mockUseCustomerAuth.mockReturnValue({
      isAuthenticated: false,
      isLoading: false,
      user: null,
    });
    rerender(<OgabasseyV2Wallet />);

    expect(
      screen.queryByTestId('wallet-funding-panel')
    ).not.toBeInTheDocument();
  });
});
