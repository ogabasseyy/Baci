import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import { WalletFundAccountCard } from './WalletFundAccountCard';

let mockFeedback: string | null = null;
const mockCopy = jest.fn();
const mockHookOptions = jest.fn();
jest.mock('@/hooks/use-copy-to-clipboard', () => ({
  useCopyToClipboard: (options?: unknown) => {
    mockHookOptions(options);
    return { copyToClipboard: mockCopy, feedback: mockFeedback };
  },
}));

const legacy = {
  accountName: 'OGB / JOHN DOE',
  accountNumber: '9814644749',
  bankName: 'Wema Bank',
  provider: 'paystack' as const,
};
const piggyvest = {
  accountName: 'Default Wallet',
  accountNumber: '9000002044',
  bankName: 'FAAS (SANDBOX)',
  provider: 'piggyvest' as const,
};

describe('Add money account card with the server keeping PiggyVest off', () => {
  beforeEach(() => {
    mockFeedback = null;
    jest.clearAllMocks();
  });

  it('keeps today’s card for another store: account name and the feedback line', () => {
    mockFeedback = 'Account number copied to clipboard.';
    render(
      <WalletFundAccountCard colors={Colors.light} fundingAccount={legacy} />
    );

    expect(screen.getByText('OGB / JOHN DOE')).toBeOnTheScreen();
    expect(screen.getByText('Wema Bank')).toBeOnTheScreen();
    expect(
      screen.getByText('Account number copied to clipboard.')
    ).toBeOnTheScreen();
    expect(mockHookOptions).toHaveBeenCalledWith(undefined);
  });
});

describe('bugfix: PiggyVest copy line made the Add money sheet jump', () => {
  beforeEach(() => {
    mockFeedback = null;
    jest.clearAllMocks();
  });

  it('shows "Copied" in place of the bank name, with no extra line', () => {
    mockFeedback = 'Copied';
    render(
      <WalletFundAccountCard colors={Colors.light} fundingAccount={piggyvest} />
    );

    expect(screen.getByText('Copied')).toBeOnTheScreen();
    expect(screen.queryByText('FAAS (SANDBOX)')).toBeNull();
    expect(
      screen.queryByText('Account number copied to clipboard.')
    ).toBeNull();
  });

  it('does not show the provider’s internal "Default Wallet" label', () => {
    render(
      <WalletFundAccountCard colors={Colors.light} fundingAccount={piggyvest} />
    );

    expect(screen.queryByText('Default Wallet')).toBeNull();
    expect(screen.getByText('9000002044')).toBeOnTheScreen();
  });
});
