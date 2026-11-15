import { render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import { WalletPaySheet } from './WalletPaySheet';

jest.mock('@react-native-vector-icons/ionicons', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('@/components/ui/ModalSheet', () => ({
  ModalSheet: ({
    visible,
    children,
  }: {
    visible: boolean;
    children: unknown;
  }) => (visible ? children : null),
}));

describe('WalletPaySheet with the server keeping PiggyVest off', () => {
  it('shows nothing while no payment was started', () => {
    render(
      <WalletPaySheet
        colors={Colors.light}
        purchase="IMEI check"
        sheet={{
          step: 'closed',
          pin: '',
          setPin: jest.fn(),
          error: null,
          outcome: null,
          amountKobo: null,
          busy: false,
          open: jest.fn(),
          nextSession: jest.fn(() => () => true),
          submit: jest.fn(),
          recheck: jest.fn(),
          close: jest.fn(),
          back: jest.fn(),
          retryStart: jest.fn(),
        }}
        onOpenWallet={jest.fn()}
        onSignIn={jest.fn()}
      />
    );
    expect(screen.queryByText('Pay from PiggyVest')).toBeNull();
    expect(screen.queryByText('Enter your wallet PIN')).toBeNull();
  });
});
