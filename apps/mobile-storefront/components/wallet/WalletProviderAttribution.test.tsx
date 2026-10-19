import { render, screen } from '@testing-library/react-native';
import { WalletProviderAttribution } from './WalletProviderAttribution';

it('attributes PiggyVest funding accounts', () => {
  render(<WalletProviderAttribution provider="piggyvest" color="#999999" />);
  expect(screen.getByText('Powered by PiggyVest')).toBeOnTheScreen();
});

it.each([
  'paystack',
  '',
  'unknown',
])('does not mislabel %s accounts', (provider) => {
  render(<WalletProviderAttribution provider={provider} color="#999999" />);
  expect(screen.queryByText('Powered by PiggyVest')).toBeNull();
});
