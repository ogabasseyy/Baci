import { fireEvent, render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import { StartSavingsSuccessModal } from './StartSavingsSuccessModal';
import type { StartSavingsController } from './start-savings-controller.types';

describe('StartSavingsSuccessModal', () => {
  it('congratulates the customer and still goes to the wallet', () => {
    const goToWallet = jest.fn();
    const controller = {
      goToWallet,
      showSuccessModal: true,
    } as unknown as StartSavingsController;
    render(
      <StartSavingsSuccessModal colors={Colors.light} controller={controller} />
    );
    expect(
      screen.getByText('Savings plan created successfully')
    ).toBeOnTheScreen();
    expect(screen.getByText(/You're off to a great start/)).toBeOnTheScreen();
    fireEvent.press(screen.getByRole('button', { name: 'Go to wallet' }));
    expect(goToWallet).toHaveBeenCalledTimes(1);
  });
});
