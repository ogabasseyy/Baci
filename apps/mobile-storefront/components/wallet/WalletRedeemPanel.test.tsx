import { fireEvent, render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import { WalletRedeemPanel } from './WalletRedeemPanel';

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

describe('WalletRedeemPanel', () => {
  const props = {
    colors: Colors.light,
    isRedeemPending: false,
    loyaltyPoints: 2500,
    minimumRedeemablePoints: 100,
    onChangeRedeemPoints: jest.fn(),
    onConfirmRedeem: jest.fn(),
    onResetRedeem: jest.fn(),
    redeemPoints: '',
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders loyalty benefits, current points, and minimum redeem hint', () => {
    render(<WalletRedeemPanel {...props} />);

    expect(screen.getByText('Redeem Loyalty Points')).toBeOnTheScreen();
    expect(screen.getByText('Available: 2,500 points')).toBeOnTheScreen();
    expect(screen.getByText('✨ Loyalty Points Benefits')).toBeOnTheScreen();
    expect(screen.getByPlaceholderText('Enter points to redeem (min 100)'));
  });

  it('lists Silver, Gold, and Platinum without advertising Bronze', () => {
    render(<WalletRedeemPanel {...props} />);

    expect(screen.queryByText('BRONZE')).toBeNull();
    expect(screen.getByText('SILVER')).toBeOnTheScreen();
    expect(screen.getByText('GOLD')).toBeOnTheScreen();
    expect(screen.getByText('PLATINUM')).toBeOnTheScreen();
  });

  it('wires redeem input and action callbacks', () => {
    render(<WalletRedeemPanel {...props} />);

    fireEvent.changeText(screen.getByLabelText('Points to redeem'), '500');
    fireEvent.press(
      screen.getByRole('button', { name: 'Confirm redeem points' })
    );
    fireEvent.press(
      screen.getByRole('button', { name: 'Cancel redeem points' })
    );

    expect(props.onChangeRedeemPoints).toHaveBeenCalledWith('500');
    expect(props.onConfirmRedeem).toHaveBeenCalledTimes(1);
    expect(props.onResetRedeem).toHaveBeenCalledTimes(1);
  });
});
