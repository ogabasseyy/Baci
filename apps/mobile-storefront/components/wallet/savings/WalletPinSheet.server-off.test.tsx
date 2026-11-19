import { render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import { fetchWalletPinStatus } from '@/lib/wallet-pin-api';
import { WalletPinSheet } from './WalletPinSheet';

jest.mock('@/lib/wallet-pin-api');

describe('server keeps PiggyVest off', () => {
  beforeEach(() => jest.resetAllMocks());

  it('renders nothing and calls nothing without a PIN request', () => {
    render(
      <WalletPinSheet
        colors={Colors.light}
        request={null}
        onProof={jest.fn()}
        onCancel={jest.fn()}
      />
    );
    expect(fetchWalletPinStatus).not.toHaveBeenCalled();
    expect(screen.queryByText(/PIN/)).toBeNull();
  });

  it('shows no goal-action copy and sends nothing without a request', () => {
    render(
      <WalletPinSheet
        colors={Colors.light}
        request={null}
        onProof={jest.fn()}
        onCancel={jest.fn()}
      />
    );
    expect(screen.queryByText(/cancel this goal/)).toBeNull();
    expect(screen.queryByText(/complete this goal/)).toBeNull();
  });
});
