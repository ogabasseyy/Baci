import { render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import { WalletPayNoticeCard } from './WalletPayNoticeCard';

jest.mock('@react-native-vector-icons/ionicons', () => ({
  __esModule: true,
  default: () => null,
}));

// Pure UI: it shows what it is given and calls no server.
describe('WalletPayNoticeCard', () => {
  it('shows the message as an alert card (the sheet header shows the title)', () => {
    render(
      <WalletPayNoticeCard
        colors={Colors.light}
        notice={{
          title: 'PiggyVest payments are paused',
          message: 'Nothing was taken.',
          tone: 'info',
          action: null,
        }}
      />
    );
    expect(screen.getByTestId('wallet-pay-notice')).toHaveTextContent(
      'Nothing was taken.'
    );
    expect(screen.queryByText('PiggyVest payments are paused')).toBeNull();
  });
});
