import { render, screen } from '@testing-library/react-native';
import WalletPinRoute from '@/app/settings/wallet-pin';

jest.mock('@/components/settings/WalletPinSettingsScreen', () => {
  const { Text } = jest.requireActual('react-native');
  return { WalletPinSettingsScreen: () => <Text>wallet pin screen</Text> };
});

describe('settings/wallet-pin route', () => {
  it('renders the Wallet PIN settings screen', () => {
    render(<WalletPinRoute />);
    expect(screen.getByText('wallet pin screen')).toBeTruthy();
  });
});
