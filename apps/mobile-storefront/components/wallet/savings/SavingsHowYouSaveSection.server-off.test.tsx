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

  it('explains interest upbeat, with a respectful No and the early-cancel rule', () => {
    render(
      <SavingsHowYouSaveSection
        colors={Colors.light}
        controller={createPrimaryStartSavingsController()}
      />
    );
    expect(
      screen.getByText('Grow your money while you save.')
    ).toBeOnTheScreen();
    expect(screen.getByText('No, savings only')).toBeOnTheScreen();
    expect(
      screen.getByText('Cancel early and lose your interest.')
    ).toBeOnTheScreen();
    // No rate or amount promises while the rate is unconfirmed.
    expect(screen.queryByText(/%|per annum|p\.a\./i)).toBeNull();
  });

  it('keeps the step short: no extra wallet row or choose-once row', () => {
    render(
      <SavingsHowYouSaveSection
        colors={Colors.light}
        controller={createPrimaryStartSavingsController()}
      />
    );
    expect(screen.queryByText(/Add from your wallet anytime/)).toBeNull();
    expect(screen.queryByText(/You choose once/)).toBeNull();
  });
});
