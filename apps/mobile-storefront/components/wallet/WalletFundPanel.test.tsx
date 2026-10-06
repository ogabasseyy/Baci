import { jest } from '@jest/globals';
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { WalletFundPanel } from '@/components/wallet/WalletFundPanel';
import type { WalletDisplayFundingAccount } from '@/components/wallet/wallet.types';
import Colors from '@/constants/Colors';

const mockCopyToClipboard = jest.fn<() => Promise<void>>();

jest.mock('@/hooks/use-copy-to-clipboard', () => ({
  useCopyToClipboard: () => ({
    copyToClipboard: mockCopyToClipboard,
    feedback: null,
  }),
}));

const fundingAccount: WalletDisplayFundingAccount = {
  accountName: 'OGB / JOHN DOE',
  accountNumber: '9814644749',
  bankName: 'Wema Bank',
  provider: 'paystack',
};

function renderPanel(
  overrides: Partial<Parameters<typeof WalletFundPanel>[0]> = {}
) {
  const props = {
    canCreateFundingAccount: true,
    colors: Colors.light,
    creditWatch: {
      armCheck: jest.fn(),
      creditedAmount: null,
      reset: jest.fn(),
      returnCtaHref: undefined,
      status: 'idle' as const,
    },
    fundAmount: '',
    fundingAccount,
    isCreatingFundingAccount: false,
    isFundPending: false,
    needsPhone: false,
    onChangeFundAmount: jest.fn(),
    onConfirmFund: jest.fn(),
    onCreateFundingAccount: jest.fn(),
    onResetFund: jest.fn(),
    onSubmitPhone: jest.fn(async () => ({ success: true })),
    ...overrides,
  };
  render(<WalletFundPanel {...props} />);
  return props;
}

describe('WalletFundPanel', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('leads with the bank-transfer account number and fee note', () => {
    renderPanel();

    expect(screen.getByText('9814644749')).toBeTruthy();
    expect(screen.getByText('Wema Bank')).toBeTruthy();
    expect(screen.getByText(/1% fee, capped at ₦300/i)).toBeTruthy();
    // Card entry stays collapsed behind the toggle.
    expect(screen.queryByLabelText('Wallet top-up amount')).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Fund with card instead' })
    ).toBeTruthy();
  });

  it('explains the separate savings transfer when funding an existing plan', () => {
    renderPanel({ returnToSavings: true });

    expect(screen.getByText(/Funding adds money to your wallet/i)).toBeTruthy();
    expect(screen.getByText(/confirm the transfer/i)).toBeTruthy();
    expect(screen.getByText(/Re-enter the amount if needed/i)).toBeTruthy();
  });

  it('shows the account owner and dismisses through the close button', () => {
    const props = renderPanel();
    expect(screen.getByText('OGB / JOHN DOE')).toBeTruthy();
    expect(screen.queryByText('Powered by PiggyVest')).toBeNull();
    fireEvent.press(screen.getByRole('button', { name: 'Close add money' }));
    expect(props.onResetFund).toHaveBeenCalledTimes(1);
  });

  it('copies the account number', () => {
    renderPanel();

    fireEvent.press(
      screen.getByRole('button', { name: 'Copy wallet account number' })
    );

    expect(mockCopyToClipboard).toHaveBeenCalledWith('9814644749');
  });

  it('expands the card amount entry from the Fund with card toggle', () => {
    const props = renderPanel();

    fireEvent.press(
      screen.getByRole('button', { name: 'Fund with card instead' })
    );

    expect(screen.getByLabelText('Wallet top-up amount')).toBeTruthy();

    expect(
      screen.getByRole('button', { name: 'Continue to payment' })
    ).toHaveAccessibilityState({ disabled: true });
    expect(props.onConfirmFund).not.toHaveBeenCalled();
  });

  it('starts with card entry expanded when opened with a prefilled amount', () => {
    const props = renderPanel({ fundAmount: '1000' });

    expect(screen.getByLabelText('Wallet top-up amount')).toBeTruthy();
    fireEvent.press(
      screen.getByRole('button', { name: 'Continue to payment' })
    );
    expect(props.onConfirmFund).toHaveBeenCalledTimes(1);
  });

  it('reveals card entry when the amount is prefilled after the panel is open', () => {
    const baseProps = {
      canCreateFundingAccount: true,
      colors: Colors.light,
      creditWatch: {
        armCheck: jest.fn(),
        creditedAmount: null,
        reset: jest.fn(),
        returnCtaHref: undefined,
        status: 'idle' as const,
      },
      fundAmount: '',
      fundingAccount,
      isCreatingFundingAccount: false,
      isFundPending: false,
      needsPhone: false,
      onChangeFundAmount: jest.fn(),
      onConfirmFund: jest.fn(),
      onCreateFundingAccount: jest.fn(),
      onResetFund: jest.fn(),
      onSubmitPhone: jest.fn(async () => ({ success: true })),
    };
    const { rerender } = render(<WalletFundPanel {...baseProps} />);

    // Toggle collapsed initially with no amount.
    expect(screen.queryByLabelText('Wallet top-up amount')).toBeNull();

    // A route action (savings / checkout) prefills the amount while open.
    rerender(<WalletFundPanel {...baseProps} fundAmount="1000" />);

    expect(screen.getByLabelText('Wallet top-up amount')).toBeTruthy();
  });

  it('auto-creates the funding account when none exists (Add Money = consent)', () => {
    const props = renderPanel({ fundingAccount: null });

    expect(props.onCreateFundingAccount).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/setting up your account number/i)).toBeTruthy();
  });

  it('does not auto-create a DVA when opened with a prefilled amount (card intent)', () => {
    const props = renderPanel({ fundingAccount: null, fundAmount: '1000' });

    // Savings top-up / checkout returnTo flows are card/gateway intents.
    expect(props.onCreateFundingAccount).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Wallet top-up amount')).toBeTruthy();
    // No auto-create runs, so the "Setting up..." spinner must not linger
    // above the card form.
    expect(screen.queryByText(/setting up your account number/i)).toBeNull();
  });

  it('keeps the card intent when the prefilled amount is cleared (no DVA, no spinner)', () => {
    const baseProps = {
      canCreateFundingAccount: true,
      colors: Colors.light,
      creditWatch: {
        armCheck: jest.fn(),
        creditedAmount: null,
        reset: jest.fn(),
        returnCtaHref: undefined,
        status: 'idle' as const,
      },
      fundAmount: '1000',
      fundingAccount: null,
      isCreatingFundingAccount: false,
      isFundPending: false,
      needsPhone: false,
      onChangeFundAmount: jest.fn(),
      onConfirmFund: jest.fn(),
      onCreateFundingAccount: jest.fn(),
      onResetFund: jest.fn(),
      onSubmitPhone: jest.fn(async () => ({ success: true })),
    };
    const { rerender } = render(<WalletFundPanel {...baseProps} />);

    // Customer clears the prefilled input mid-entry.
    rerender(<WalletFundPanel {...baseProps} fundAmount="" />);

    expect(baseProps.onCreateFundingAccount).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Wallet top-up amount')).toBeTruthy();
    expect(screen.queryByText(/setting up your account number/i)).toBeNull();
  });

  it('falls back to card entry when auto-create fails instead of spinning forever', async () => {
    renderPanel({
      fundingAccount: null,
      onCreateFundingAccount: jest.fn(async () => false),
    });

    expect(
      await screen.findByText(/couldn't set up your account number/i)
    ).toBeTruthy();
    expect(screen.getByLabelText('Wallet top-up amount')).toBeTruthy();
    await waitFor(() => {
      expect(screen.queryByText(/setting up your account number/i)).toBeNull();
    });
  });

  it('shows the phone prompt (not the spinner) when a phone is needed', () => {
    // needsPhone and canCreateFundingAccount are mutually exclusive: a missing
    // phone keeps creation blocked until it is collected.
    const props = renderPanel({
      canCreateFundingAccount: false,
      fundingAccount: null,
      needsPhone: true,
    });

    // Phone collection replaces the account-setup spinner and never auto-creates.
    expect(screen.getByLabelText('Phone number')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Save phone number' })
    ).toBeTruthy();
    expect(props.onCreateFundingAccount).not.toHaveBeenCalled();
    expect(screen.queryByText(/setting up your account number/i)).toBeNull();
    // Card entry stays collapsed behind the toggle (must not auto-expand).
    expect(screen.queryByLabelText('Wallet top-up amount')).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Fund with card instead' })
    ).toBeTruthy();
  });

  it('persists the phone through onSubmitPhone from the prompt', async () => {
    const onSubmitPhone = jest.fn(async () => ({ success: true }));
    renderPanel({
      canCreateFundingAccount: false,
      fundingAccount: null,
      needsPhone: true,
      onSubmitPhone,
    });

    fireEvent.changeText(screen.getByLabelText('Phone number'), '08012345678');
    fireEvent.press(screen.getByRole('button', { name: 'Save phone number' }));

    await waitFor(() => {
      expect(onSubmitPhone).toHaveBeenCalledWith('08012345678');
    });
  });

  it('falls back to card entry with the unavailable message when accounts are disabled', () => {
    const props = renderPanel({
      canCreateFundingAccount: false,
      createFundingAccountUnavailableMessage:
        'Bank transfer funding is not available for this store yet.',
      fundingAccount: null,
    });

    expect(props.onCreateFundingAccount).not.toHaveBeenCalled();
    expect(screen.getByText(/not available for this store yet/i)).toBeTruthy();
    expect(screen.getByLabelText('Wallet top-up amount')).toBeTruthy();
  });
});
