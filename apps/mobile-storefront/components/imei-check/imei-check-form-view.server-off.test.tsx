import { IMEI_SERVICE_TIERS } from '@baci/shared/imei';
import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import Colors, { BRAND } from '@/constants/Colors';
import { ImeiCheckFormView } from './imei-check-form-view';

jest.mock('@react-native-vector-icons/ionicons', () => ({
  Ionicons: () => null,
  default: () => null,
  __esModule: true,
}));
jest.mock('expo-router', () => ({
  router: { back: jest.fn() },
  Stack: { Screen: () => null },
}));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: unknown }) => children,
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('@/hooks/use-keyboard', () => ({
  useKeyboard: () => ({
    dismissKeyboard: jest.fn(),
    isKeyboardVisible: false,
    keyboardHeight: 0,
    withKeyboardDismiss: (handler: unknown) => handler,
  }),
}));

const baseProps = {
  colors: Colors.light,
  currentTier: IMEI_SERVICE_TIERS.full,
  displayedTierKeys: ['full', 'blacklist', 'carrier'] as const,
  error: null as string | null,
  identifier: 'imei' as const,
  imei: '',
  isLoading: false,
  isWalletError: false,
  isWalletLoading: false,
  selectedBrand: 'apple' as const,
  selectedDevice: 'smartphone' as const,
  selectedTier: 'full' as const,
  canToggleServices: true,
  showAllServices: false,
  walletBalance: 0,
  onBrandSelect: jest.fn(),
  onChangeImei: jest.fn(),
  onCheck: jest.fn(),
  onClearImei: jest.fn(),
  onDeviceSelect: jest.fn(),
  onTierSelect: jest.fn(),
  onTopUpWallet: jest.fn(),
  onToggleServices: jest.fn(),
};

describe('IMEI wallet badge with the server keeping PiggyVest off', () => {
  it('keeps the wallet balance and top-up wording as today', () => {
    render(<ImeiCheckFormView {...baseProps} />);

    expect(screen.getByLabelText('Wallet balance ₦0')).toBeOnTheScreen();
    expect(screen.getByText('Top up to unlock')).toBeOnTheScreen();
    expect(
      screen.getByText('Balance low — top up ₦1,000 to run this check')
    ).toBeOnTheScreen();
    expect(screen.queryByText(/store credit/i)).toBeNull();
  });
});

describe('bugfix: IMEI check offered PiggyVest money it cannot spend', () => {
  it('shows ₦0 store credit and a store credit top-up for a PiggyVest customer', () => {
    // Arrange: ₦5,000 sits at PiggyVest; store credit (what checks spend) is ₦0.
    const onTopUpWallet = jest.fn();
    render(
      <ImeiCheckFormView
        {...baseProps}
        onTopUpWallet={onTopUpWallet}
        walletIsStoreCredit
      />
    );

    // Assert: only store credit is shown, never the ₦5,000.
    expect(screen.getByLabelText('Store credit ₦0')).toBeOnTheScreen();
    expect(screen.getByText('Store credit ₦0')).toBeOnTheScreen();
    expect(screen.queryByText(/₦5,000/)).toBeNull();
    expect(
      screen.getByText('Add ₦1,000 store credit by card to run this check')
    ).toBeOnTheScreen();

    // Act: the button opens the store credit top-up for the shortfall.
    fireEvent.press(screen.getByText('Add store credit'));
    expect(onTopUpWallet).toHaveBeenCalledWith(1000);
  });
});

describe('IMEI check paid from the PiggyVest wallet (dark)', () => {
  it('keeps the store credit top-up when wallet pay does not cover the check', () => {
    const onTopUpWallet = jest.fn();
    render(
      <ImeiCheckFormView
        {...baseProps}
        onTopUpWallet={onTopUpWallet}
        walletIsStoreCredit
        walletPay={{ covers: () => false, savingsKobo: null }}
      />
    );
    expect(screen.getByText('Add store credit')).toBeOnTheScreen();
    expect(screen.queryByText(/^Pay ₦/)).toBeNull();
  });

  it('offers to pay from PiggyVest once switched on and covered', () => {
    const onCheck = jest.fn();
    const onTopUpWallet = jest.fn();
    render(
      <ImeiCheckFormView
        {...baseProps}
        imei="356938035643809"
        onCheck={onCheck}
        onTopUpWallet={onTopUpWallet}
        walletIsStoreCredit
        walletPay={{ covers: (tier) => tier === 'full', savingsKobo: null }}
      />
    );
    const price = IMEI_SERVICE_TIERS.full.price.toLocaleString('en-NG');
    // Customers never see the provider's name (owner 11-13).
    expect(screen.queryByText(/PiggyVest/)).toBeNull();
    // The check it pays for is named beside the savings badge (Fable walk 15).
    fireEvent.press(
      screen.getByText(`Pay ₦${price} for ${IMEI_SERVICE_TIERS.full.name}`)
    );
    expect(onCheck).toHaveBeenCalledTimes(1);
    expect(onTopUpWallet).not.toHaveBeenCalled();
  });
});

describe('bugfix: "Retry available checks" looked like plain text (walk-through L10)', () => {
  it('draws the retry as an outlined button that retries', () => {
    const onRetryAvailability = jest.fn();
    render(
      <ImeiCheckFormView
        {...baseProps}
        availabilityFailed
        onRetryAvailability={onRetryAvailability}
      />
    );
    const retry = screen.getByRole('button', {
      name: 'Retry available checks',
    });
    expect(retry).toHaveStyle({ borderWidth: 1, borderColor: BRAND.primary });
    fireEvent.press(retry);
    expect(onRetryAvailability).toHaveBeenCalledTimes(1);
  });
});

describe('bugfix: the wallet badge read ₦0 before the wallet loaded (Fable walk)', () => {
  it('shows an unknown balance while loading and when the read failed', () => {
    const { rerender } = render(
      <ImeiCheckFormView {...baseProps} isWalletLoading />
    );
    expect(screen.queryByText('₦0')).toBeNull();
    expect(screen.getByText('…')).toBeOnTheScreen();
    rerender(<ImeiCheckFormView {...baseProps} isWalletError />);
    expect(screen.queryByText('₦0')).toBeNull();
    expect(screen.getByText('…')).toBeOnTheScreen();
  });
});

describe('bugfix: the badge read store credit ₦0 for a funded savings wallet (Fable walk)', () => {
  it('shows the savings wallet balance when paying from PiggyVest is on', () => {
    render(
      <ImeiCheckFormView
        {...baseProps}
        walletIsStoreCredit
        walletPay={{ covers: () => true, savingsKobo: 54_970_000 }}
      />
    );
    expect(screen.getByText('Savings ₦549,700')).toBeOnTheScreen();
    expect(screen.queryByText(/₦0$/)).toBeNull();
  });

  it('keeps the store credit badge when paying from PiggyVest is off', () => {
    render(
      <ImeiCheckFormView
        {...baseProps}
        walletIsStoreCredit
        walletPay={{ covers: () => false, savingsKobo: null }}
      />
    );
    expect(screen.queryByText(/^Savings/)).toBeNull();
  });
});

describe('bugfix: the savings badge showed beside a store credit top-up (Codex P2)', () => {
  it('shows store credit when the chosen check is not paid from the savings wallet', () => {
    render(
      <ImeiCheckFormView
        {...baseProps}
        walletIsStoreCredit
        walletPay={{ covers: () => false, savingsKobo: 1_000_000 }}
      />
    );
    expect(screen.queryByText(/^Savings/)).toBeNull();
  });
});
