import { fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';
import { SettingsWalletPinSection } from './SettingsWalletPinSection';

let mockGate: { state: string; status: unknown; refresh: () => void } = {
  state: 'checking',
  status: null,
  refresh: jest.fn(),
};
jest.mock('./use-wallet-pin-settings-gate', () => ({
  useWalletPinSettingsGate: () => mockGate,
}));
jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
  useNavigation: () => ({ addListener: jest.fn(() => jest.fn()) }),
}));
jest.mock('@/components/useColorScheme', () => ({
  useColorScheme: () => 'light',
}));
jest.mock('react-native-reanimated', () => {
  const { View } = jest.requireActual('react-native');
  return {
    __esModule: true,
    default: { View },
    FadeInDown: { delay: () => ({ duration: () => ({}) }) },
  };
});

const base = { primary: true, available: true };

describe('SettingsWalletPinSection', () => {
  it('shows the row with the has-PIN subtitle and opens the screen', () => {
    mockGate = {
      state: 'ready',
      status: { ...base, hasPin: true, resetRequired: false },
      refresh: jest.fn(),
    };
    render(<SettingsWalletPinSection />);
    expect(screen.getByText('SECURITY')).toBeTruthy();
    expect(screen.getByText('Protects money leaving your wallet')).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: /Wallet PIN/ }));
    expect(router.push).toHaveBeenCalledWith('/settings/wallet-pin');
  });

  it('shows the no-PIN subtitle', () => {
    mockGate = {
      state: 'ready',
      status: { ...base, hasPin: false, resetRequired: false },
      refresh: jest.fn(),
    };
    render(<SettingsWalletPinSection />);
    expect(
      screen.getByText('Set a PIN to protect money leaving your wallet')
    ).toBeTruthy();
  });

  it('shows the reset subtitle when a reset is required', () => {
    mockGate = {
      state: 'ready',
      status: { ...base, hasPin: true, resetRequired: true },
      refresh: jest.fn(),
    };
    render(<SettingsWalletPinSection />);
    expect(screen.getByText('Reset your PIN to continue')).toBeTruthy();
  });

  it.each(['checking', 'off'])('renders nothing while %s', (state) => {
    mockGate = { state, status: null, refresh: jest.fn() };
    render(<SettingsWalletPinSection />);
    expect(screen.queryByText('Wallet PIN')).toBeNull();
    expect(screen.queryByText('SECURITY')).toBeNull();
  });
});
