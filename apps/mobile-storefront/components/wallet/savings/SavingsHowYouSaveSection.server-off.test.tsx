import { fireEvent, render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import { SavingsHowYouSaveSection } from './SavingsHowYouSaveSection';
import {
  createPrimaryStartSavingsController,
  createStartSavingsController,
} from './start-savings-controller.test-support';

describe('SavingsHowYouSaveSection with PiggyVest off', () => {
  it('offers manual and auto debit with plain copy', () => {
    const controller = createStartSavingsController();
    render(
      <SavingsHowYouSaveSection colors={Colors.light} controller={controller} />
    );
    expect(
      screen.getByText(/You add money from your wallet whenever you like/)
    ).toBeOnTheScreen();
    expect(screen.queryByText(/Manual debit uses wallet balance/)).toBeNull();
    fireEvent.press(
      screen.getByRole('radio', { name: 'Use auto debit for savings' })
    );
    expect(controller.handleSourceModeChange).toHaveBeenCalledWith(
      'auto_debit'
    );
  });

  it('toggles the terms', () => {
    const controller = createStartSavingsController();
    render(
      <SavingsHowYouSaveSection colors={Colors.light} controller={controller} />
    );
    fireEvent.press(
      screen.getByRole('checkbox', {
        name: 'Accept non-withdrawable savings terms',
      })
    );
    expect(controller.setAcceptsNonWithdrawableTerms).toHaveBeenCalled();
  });
});

describe('SavingsHowYouSaveSection for a PiggyVest wallet', () => {
  it('hides auto debit and asks the interest question', () => {
    render(
      <SavingsHowYouSaveSection
        colors={Colors.light}
        controller={createPrimaryStartSavingsController()}
      />
    );
    expect(
      screen.queryByRole('radio', { name: 'Use auto debit for savings' })
    ).toBeNull();
    expect(
      screen.getByText('Earn interest on your savings?')
    ).toBeOnTheScreen();
  });
});
