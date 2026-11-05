import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { setClipboardString } from '@/lib/clipboard';
import { WalletContent } from './WalletContent';
import { createWalletContentProps } from './wallet-content.test-utils';

jest.mock('react-native-reanimated', () => {
  const { View } = jest.requireActual(
    'react-native'
  ) as typeof import('react-native');

  return {
    __esModule: true,
    default: { View },
    FadeIn: {
      duration: () => ({
        delay: () => ({}),
      }),
    },
  };
});

jest.mock('@/lib/clipboard', () => ({
  setClipboardString: jest.fn(),
}));

jest.mock('@/hooks/use-debounce', () => ({
  useDebounce: (value: string) => value,
}));

jest.mock('@/hooks/use-product-search', () => ({
  useProductSearch: () => ({
    isLoading: false,
    products: [
      {
        condition: 'Used',
        id: 'product-swap',
        image: 'https://cdn.example.com/swap.jpg',
        name: 'iPhone 16 Pro',
        price: 150000,
        slug: 'iphone-16-pro',
      },
    ],
  }),
}));

jest.mock('expo-image', () => ({
  Image: () => null,
}));

// Default off (production state); individual tests flip it on to exercise the
// credit-check affordance.
let mockCheckingStateEnabled = false;

jest.mock('@/constants/wallet-funding', () => ({
  get WALLET_FUNDING_CHECKING_STATE_ENABLED() {
    return mockCheckingStateEnabled;
  },
  WALLET_FUNDING_POLLING: { INTERVAL_MS: 5000, TIMEOUT_MS: 120000 },
}));

const mockSetClipboardString = jest.mocked(setClipboardString);

describe('WalletContent', () => {
  const props = createWalletContentProps();

  beforeEach(() => {
    jest.clearAllMocks();
    mockCheckingStateEnabled = false;
    mockSetClipboardString.mockResolvedValue(true);
  });

  it('mounts a single credit-check affordance while the fund panel is open', () => {
    mockCheckingStateEnabled = true;

    render(<WalletContent hasSavedCards {...props} showFundPanel={true} />);

    // The fund panel owns the interactive affordance; the hero must not mount
    // a duplicate alongside it.
    expect(
      screen.getAllByRole('button', {
        name: "I've transferred — check for it",
      })
    ).toHaveLength(1);
  });

  it('shows the hero credit-check affordance when the fund panel is closed', () => {
    mockCheckingStateEnabled = true;

    render(<WalletContent hasSavedCards {...props} showFundPanel={false} />);

    expect(
      screen.getAllByRole('button', {
        name: "I've transferred — check for it",
      })
    ).toHaveLength(1);
  });

  it('dismisses the fund panel bottom sheet through the backdrop', () => {
    const onResetFund = jest.fn();
    render(
      <WalletContent
        hasSavedCards
        {...props}
        showFundPanel={true}
        onResetFund={onResetFund}
      />
    );

    fireEvent.press(screen.getByRole('button', { name: 'Dismiss modal' }));

    expect(onResetFund).toHaveBeenCalled();
  });

  it('renders earnings, savings, loyalty points, and primary actions', () => {
    render(<WalletContent hasSavedCards {...props} />);

    expect(screen.getByText('Total Balance · NGN')).toBeOnTheScreen();
    expect(screen.getByText('Total Balance · NGN')).toBeOnTheScreen();
    expect(screen.getByText('₦160,000')).toBeOnTheScreen();
    expect(screen.getAllByText('Earnings').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Savings').length).toBeGreaterThan(0);
    expect(screen.getAllByText('2,000 pts')).toHaveLength(1);
    expect(screen.queryByText('Redeem Rewards')).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Redeem loyalty points' })
    ).toBeOnTheScreen();
    expect(
      screen.getByRole('button', { name: 'Add to savings for iPhone 15 Pro' })
    ).toBeOnTheScreen();
    expect(
      screen.getByRole('button', { name: 'Manage Cards' })
    ).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Withdraw from wallet' })).toBe(
      null
    );
  });

  it('copies the funding account number from the account pill', async () => {
    render(<WalletContent hasSavedCards {...props} />);

    fireEvent.press(
      screen.getByRole('button', { name: 'Copy funding account number' })
    );

    await waitFor(() =>
      expect(mockSetClipboardString).toHaveBeenCalledWith('1234567890')
    );
    expect(
      await screen.findByText('Account number copied to clipboard.')
    ).toBeOnTheScreen();
  });

  it('clears inline copy feedback after a short delay', async () => {
    jest.useFakeTimers();
    try {
      render(<WalletContent hasSavedCards {...props} />);

      fireEvent.press(
        screen.getByRole('button', { name: 'Copy funding account number' })
      );

      expect(
        await screen.findByText('Account number copied to clipboard.')
      ).toBeOnTheScreen();

      act(() => {
        jest.advanceTimersByTime(3000);
      });

      expect(
        screen.queryByText('Account number copied to clipboard.')
      ).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });

  it('shows inline feedback when account number copy fails', async () => {
    mockSetClipboardString.mockResolvedValue(false);
    render(<WalletContent hasSavedCards {...props} />);

    fireEvent.press(
      screen.getByRole('button', { name: 'Copy funding account number' })
    );

    expect(
      await screen.findByText('Could not copy account number.')
    ).toBeOnTheScreen();
  });

  it('shows create account button when no funding account exists', () => {
    render(<WalletContent hasSavedCards {...props} fundingAccount={null} />);

    expect(
      screen.getByRole('button', { name: 'Create account number' })
    ).toBeOnTheScreen();
  });

  it('passes through account creation unavailable messaging', () => {
    render(
      <WalletContent
        hasSavedCards
        {...props}
        canCreateFundingAccount={false}
        createFundingAccountUnavailableMessage="Add a phone number to create your account number."
        fundingAccount={null}
      />
    );

    expect(
      screen.getByText('Add a phone number to create your account number.')
    ).toBeOnTheScreen();
  });

  it('shows the phone prompt in the fund panel when a phone is needed', () => {
    render(
      <WalletContent
        hasSavedCards
        {...props}
        canCreateFundingAccount={false}
        fundingAccount={null}
        needsPhone={true}
        showFundPanel={true}
      />
    );

    expect(screen.getByLabelText('Phone number')).toBeOnTheScreen();
    expect(
      screen.getByRole('button', { name: 'Save phone number' })
    ).toBeOnTheScreen();
  });

  it('wires the plan action and card management without duplicate savings buttons', () => {
    render(<WalletContent hasSavedCards {...props} />);

    fireEvent.press(
      screen.getByRole('button', { name: 'Add to savings for iPhone 15 Pro' })
    );
    fireEvent.press(screen.getByRole('button', { name: 'Manage Cards' }));

    expect(props.onStartSavings).toHaveBeenCalledTimes(1);
    expect(props.onManageCards).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Quick Save' })).toBeNull();
  });

  it('opens loyalty redemption from the hero loyalty row', () => {
    render(<WalletContent hasSavedCards {...props} />);

    fireEvent.press(
      screen.getByRole('button', { name: 'Redeem loyalty points' })
    );

    expect(props.onOpenRedeemPanel).toHaveBeenCalledTimes(1);
  });

  it('hides quick save when there is no active savings context', () => {
    render(
      <WalletContent
        hasSavedCards
        {...props}
        activeSavingsGoal={null}
        showQuickSave={false}
      />
    );

    expect(screen.queryByRole('button', { name: 'Quick Save' })).toBeNull();
  });

  it('does not update copy feedback after unmounting', async () => {
    let resolveClipboard: (copied: boolean) => void = () => undefined;
    const consoleErrorSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    mockSetClipboardString.mockReturnValue(
      new Promise<boolean>((resolve) => {
        resolveClipboard = resolve;
      })
    );

    try {
      const { unmount } = render(<WalletContent hasSavedCards {...props} />);

      fireEvent.press(
        screen.getByRole('button', { name: 'Copy funding account number' })
      );
      unmount();

      await act(async () => {
        resolveClipboard(true);
        // Flush the clipboard promise microtask before asserting no post-unmount state update.
        await Promise.resolve();
      });

      expect(consoleErrorSpy).not.toHaveBeenCalled();
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });
});
