import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type MockMerchantBankFormProps = {
  merchantId: string;
  countryCode?: string | null;
  initialData?: {
    accountNumber?: string;
    accountName?: string;
    bankName?: string;
    businessName?: string;
  };
  onSuccess?: (savedBank: {
    accountName?: string;
    accountNumber: string;
    bankCode?: string;
    bankName?: string;
    businessName: string;
    merchantId: string;
  }) => void;
};

const merchantBankFormProps = vi.hoisted(
  () => [] as MockMerchantBankFormProps[]
);
const reloadMerchantMock = vi.hoisted(() => vi.fn());
const useMerchantMock = vi.hoisted(() => vi.fn());

vi.mock('@/components/merchant-bank-form', () => ({
  MerchantBankForm: (props: MockMerchantBankFormProps) => {
    merchantBankFormProps.push(props);
    return (
      <button
        data-testid="merchant-bank-form"
        onClick={() =>
          props.onSuccess?.({
            accountName: 'Updated Account Name',
            accountNumber: '1234567890',
            bankCode: '044',
            bankName: 'Guaranty Trust Bank',
            businessName: 'Updated Store',
            merchantId: props.merchantId,
          })
        }
        type="button"
      >
        Mock Bank Form
      </button>
    );
  },
}));

vi.mock('@/hooks/use-merchant-client', () => ({
  useMerchant: useMerchantMock,
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: vi.fn(() => ({ toast: vi.fn() })),
}));

vi.mock('@/lib/api-client', () => ({
  fetchWithCsrf: vi.fn(),
}));

vi.mock('./components/virtual-terminal-settings', () => ({
  VirtualTerminalSettings: () => (
    <div data-testid="virtual-terminal-settings" />
  ),
}));

import { fetchWithCsrf } from '@/lib/api-client';
import PaymentSettingsPage from './page';

const featureSettings = {
  paystack_enabled: false,
  korapay_enabled: false,
  pay_on_delivery_enabled: false,
  preferred_local_gateway: 'paystack',
  preferred_international_gateway: 'paystack',
  credit_direct_enabled: false,
  oxygen_enabled: false,
};

describe('PaymentSettingsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    merchantBankFormProps.length = 0;
    window.history.replaceState({}, '', '/dashboard/settings/payments');
    useMerchantMock.mockReturnValue({
      merchant: {
        id: 'merchant-1',
        business_name: 'Yodha Shopping',
        country: 'IN',
        bank_account_number: null,
        paystack_subaccount_code: null,
      },
      loading: false,
      reloadMerchant: reloadMerchantMock,
    });
    vi.mocked(fetchWithCsrf).mockResolvedValue({
      ok: true,
      json: async () => ({}),
    } as Response);
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => featureSettings,
      })
      .mockResolvedValue({
        ok: true,
        json: async () => ({}),
      }) as typeof fetch;
  });

  it('withholds payout forms when no merchant context is established', async () => {
    useMerchantMock.mockReturnValue({
      merchant: null,
      loading: false,
      reloadMerchant: reloadMerchantMock,
    });

    render(<PaymentSettingsPage />);

    expect(
      await screen.findByText(/merchant context is unavailable/i)
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /mock bank form/i })
    ).not.toBeInTheDocument();
    expect(merchantBankFormProps).toHaveLength(0);
  });

  it('re-enables the save button when onboarding payment settings save fails', async () => {
    const user = userEvent.setup();
    window.history.replaceState(
      {},
      '',
      '/dashboard/settings/payments?onboarding=true'
    );
    vi.mocked(fetchWithCsrf).mockResolvedValueOnce({
      ok: false,
      json: async () => ({}),
    } as Response);

    render(<PaymentSettingsPage />);

    await screen.findByRole('heading', { name: /pay on delivery/i });
    const saveButton = screen.getByRole('button', { name: /save settings/i });

    await user.click(saveButton);

    await waitFor(() => {
      expect(saveButton).toBeEnabled();
    });
  });

  it('collects manual invoice bank details for India merchants', async () => {
    useMerchantMock.mockReturnValue({
      merchant: {
        id: 'merchant-1',
        business_name: 'Yodha Shopping',
        country: 'IN',
        bank_account_number: 'IN-123456789012',
        bank_account_name: 'Yodha Shopping',
        bank_name: 'HDFC Bank',
        paystack_subaccount_code: null,
      },
      loading: false,
      reloadMerchant: reloadMerchantMock,
    });

    render(<PaymentSettingsPage />);

    expect(
      await screen.findByText(/manual invoice bank details/i)
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /mock bank form/i })
    ).toBeInTheDocument();
    expect(merchantBankFormProps[0]).toEqual(
      expect.objectContaining({
        countryCode: 'IN',
        initialData: expect.objectContaining({
          accountNumber: 'IN-123456789012',
          accountName: 'Yodha Shopping',
          bankName: 'HDFC Bank',
          businessName: 'Yodha Shopping',
        }),
      })
    );
  });

  it('does not show hardcoded Nigerian currency labels for India merchants', async () => {
    render(<PaymentSettingsPage />);

    expect(
      await screen.findByRole('heading', { name: /payment settings/i })
    ).toBeInTheDocument();

    expect(screen.getByText('Local Payments (INR)')).toBeInTheDocument();
    expect(screen.getByText(/Baci charges/i)).toHaveTextContent(
      '2% per transaction'
    );
    expect(screen.getByText(/Baci charges/i)).not.toHaveTextContent('₹2,050');
    expect(
      screen.queryByText(/Local Payments \(NGN\)/i)
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/N2,050/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/N100/i)).not.toBeInTheDocument();
    expect(
      screen.queryByText(/Nigerian Naira \(NGN\)/i)
    ).not.toBeInTheDocument();
  });

  it('keeps Paystack fee copy Nigerian for Nigerian merchants', async () => {
    useMerchantMock.mockReturnValue({
      merchant: {
        id: 'merchant-1',
        business_name: 'Baci Store',
        country: 'NG',
        bank_account_number: '1234567890',
        bank_account_name: 'Baci Store',
        bank_code: '044',
        bank_name: 'Guaranty Trust Bank',
        paystack_subaccount_code: 'ACCT_test123',
      },
      loading: false,
      reloadMerchant: reloadMerchantMock,
    });

    render(<PaymentSettingsPage />);

    expect(
      await screen.findByRole('heading', { name: /payment settings/i })
    ).toBeInTheDocument();

    expect(screen.getByText('Local Payments (NGN)')).toBeInTheDocument();
    expect(screen.getByText(/Paystack:/i)).toHaveTextContent('₦100');
    expect(screen.getByText(/Baci charges/i)).toHaveTextContent('₦2,050');
  });

  it('persists Oxygen toggle state when saved from payment settings', async () => {
    const user = userEvent.setup();
    render(<PaymentSettingsPage />);

    const oxygenSwitch = await screen.findByRole('switch', {
      name: /toggle oxygen/i,
    });
    expect(oxygenSwitch).not.toBeChecked();

    await user.click(oxygenSwitch);
    expect(oxygenSwitch).toBeChecked();

    await user.click(screen.getByRole('button', { name: /save settings/i }));

    await waitFor(() => {
      expect(fetchWithCsrf).toHaveBeenCalledWith(
        '/api/merchant/features',
        expect.objectContaining({
          method: 'PATCH',
        })
      );
    });
    const lastBody = JSON.parse(
      String(vi.mocked(fetchWithCsrf).mock.calls.at(-1)?.[1]?.body)
    );
    expect(lastBody).toMatchObject({
      merchantId: 'merchant-1',
      oxygen_enabled: true,
    });
  });
});
