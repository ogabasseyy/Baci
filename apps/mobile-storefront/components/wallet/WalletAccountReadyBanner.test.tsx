import { render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import { triggerHaptic } from '@/hooks/use-haptics';
import { WalletAccountReadyBanner } from './WalletAccountReadyBanner';

jest.mock('@/hooks/use-haptics', () => ({ triggerHaptic: jest.fn() }));
jest.mock('react-native-reanimated', () => {
  const { View } = require('react-native');
  return {
    __esModule: true,
    default: { View },
    FadeIn: { duration: () => ({}) },
  };
});

it('celebrates confirmed account setup once within the existing sheet', () => {
  const { rerender } = render(
    <WalletAccountReadyBanner colors={Colors.dark} />
  );
  expect(screen.getByText('Your wallet is ready!')).toBeOnTheScreen();
  expect(triggerHaptic).toHaveBeenCalledWith('success');
  rerender(<WalletAccountReadyBanner colors={Colors.light} />);
  expect(triggerHaptic).toHaveBeenCalledTimes(1);
});
