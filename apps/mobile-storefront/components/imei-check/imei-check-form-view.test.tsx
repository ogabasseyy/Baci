import { IMEI_SERVICE_TIERS } from '@baci/shared/imei';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import Colors, { SPACING } from '@/constants/Colors';
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

const mockInsets = { top: 0, bottom: 0, left: 0, right: 0 };
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: unknown }) => children,
  useSafeAreaInsets: () => mockInsets,
}));

jest.mock('@/components/ui/AppKeyboardContainer', () => ({
  __esModule: true,
  default: ({ children }: { children: unknown }) => children,
}));

const mockKeyboardResult = {
  isKeyboardVisible: false,
  keyboardHeight: 0,
  dismissKeyboard: jest.fn(),
  withKeyboardDismiss: (handler: unknown) => handler,
};
jest.mock('@/hooks/use-keyboard', () => ({
  useKeyboard: () => mockKeyboardResult,
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
  walletBalance: 5000,
  onBrandSelect: jest.fn(),
  onChangeImei: jest.fn(),
  onCheck: jest.fn(),
  onClearImei: jest.fn(),
  onDeviceSelect: jest.fn(),
  onTierSelect: jest.fn(),
  onTopUpWallet: jest.fn(),
  onToggleServices: jest.fn(),
};

describe('ImeiCheckFormView', () => {
  it('renders the verify CTA with the current tier price', () => {
    render(<ImeiCheckFormView {...baseProps} />);

    expect(screen.getByText('Verify Now - ₦1,000')).toBeTruthy();
  });

  it('disables the verify button when the IMEI is shorter than 15 digits', () => {
    const onCheck = jest.fn();
    render(<ImeiCheckFormView {...baseProps} imei="12345" onCheck={onCheck} />);

    const button = screen.getByText('Verify Now - ₦1,000').parent;
    expect(button).toBeTruthy();
    fireEvent.press(button as NonNullable<typeof button>);

    expect(onCheck).not.toHaveBeenCalled();
  });

  it('keeps the verify button disabled when the IMEI checksum is invalid', () => {
    const onCheck = jest.fn();
    render(
      <ImeiCheckFormView
        {...baseProps}
        imei="123456789012345"
        onCheck={onCheck}
      />
    );

    fireEvent.press(screen.getByText('Verify Now - ₦1,000'));

    expect(onCheck).not.toHaveBeenCalled();
  });

  it('invokes onCheck when verify is pressed with a valid IMEI', () => {
    const onCheck = jest.fn();
    render(
      <ImeiCheckFormView
        {...baseProps}
        imei="490154203237518"
        onCheck={onCheck}
      />
    );

    fireEvent.press(screen.getByText('Verify Now - ₦1,000'));

    expect(onCheck).toHaveBeenCalledTimes(1);
  });

  it('replaces the verify CTA with a loading indicator while a check is in flight', () => {
    render(
      <ImeiCheckFormView {...baseProps} imei="490154203237518" isLoading />
    );

    expect(screen.queryByText('Verify Now - ₦1,000')).toBeNull();
  });

  it('turns the button into a top-up action when wallet balance is short', () => {
    const onCheck = jest.fn();
    const onTopUpWallet = jest.fn();
    render(
      <ImeiCheckFormView
        {...baseProps}
        imei="490154203237518"
        walletBalance={500}
        onCheck={onCheck}
        onTopUpWallet={onTopUpWallet}
      />
    );

    expect(screen.getByText('Top up to unlock')).toBeTruthy();
    fireEvent.press(screen.getByText('Top up to unlock'));

    expect(onTopUpWallet).toHaveBeenCalledTimes(1);
    expect(onTopUpWallet).toHaveBeenCalledWith(500);
    expect(onCheck).not.toHaveBeenCalled();
  });

  it('disables verify while the wallet balance is loading', () => {
    const onCheck = jest.fn();
    render(
      <ImeiCheckFormView
        {...baseProps}
        imei="490154203237518"
        isWalletLoading
        onCheck={onCheck}
      />
    );

    expect(screen.getByText('Loading wallet balance...')).toBeTruthy();
    fireEvent.press(screen.getByText('Loading wallet...'));

    expect(onCheck).not.toHaveBeenCalled();
  });

  it('disables verify when the wallet balance cannot be loaded', () => {
    const onCheck = jest.fn();
    render(
      <ImeiCheckFormView
        {...baseProps}
        imei="490154203237518"
        isWalletError
        onCheck={onCheck}
      />
    );

    expect(
      screen.getByText(
        'Wallet balance unavailable. Refresh your wallet and try again.'
      )
    ).toBeTruthy();
    fireEvent.press(screen.getByText('Wallet unavailable'));

    expect(onCheck).not.toHaveBeenCalled();
  });

  describe('footer safe-area inset vs keyboard', () => {
    beforeEach(() => {
      mockInsets.bottom = 34;
      mockKeyboardResult.isKeyboardVisible = false;
    });

    afterEach(() => {
      mockInsets.bottom = 0;
      mockKeyboardResult.isKeyboardVisible = false;
    });

    it('keeps the home-indicator inset when the keyboard is closed', () => {
      render(<ImeiCheckFormView {...baseProps} />);

      expect(screen.getByTestId('imei-check-footer')).toHaveStyle({
        paddingBottom: 34,
      });
    });

    it('drops to base padding while the keyboard is open (inset is under the keyboard)', () => {
      mockKeyboardResult.isKeyboardVisible = true;

      render(<ImeiCheckFormView {...baseProps} />);

      expect(screen.getByTestId('imei-check-footer')).toHaveStyle({
        paddingBottom: SPACING.sm,
      });
    });
  });
});
