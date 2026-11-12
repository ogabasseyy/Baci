import { describe, expect, it } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import { StartSavingsForm } from './StartSavingsForm';
import {
  createPrimaryStartSavingsController,
  createStartSavingsController,
} from './start-savings-controller.test-support';

describe('StartSavingsForm with PiggyVest off', () => {
  it('lays the setup out as three joined steps with the first one done', () => {
    render(
      <StartSavingsForm
        colors={Colors.light}
        controller={createStartSavingsController()}
      />
    );
    expect(
      screen.getByLabelText('Step 1, Pick your phone, done')
    ).toBeOnTheScreen();
    expect(
      screen.getByLabelText('Step 2, Make it a habit, done')
    ).toBeOnTheScreen();
    expect(
      screen.getByLabelText('Step 3, How you’ll save, current step')
    ).toBeOnTheScreen();
  });

  it('keeps later steps grey and closed until a phone is picked', () => {
    render(
      <StartSavingsForm
        colors={Colors.light}
        controller={createStartSavingsController({ selectedProduct: null })}
      />
    );
    expect(
      screen.getByLabelText('Step 1, Pick your phone, current step')
    ).toBeOnTheScreen();
    expect(
      screen.getByLabelText('Step 2, Make it a habit, not started')
    ).toBeOnTheScreen();
    expect(screen.queryByLabelText('Savings contribution amount')).toBeNull();
  });

  it('still offers manual and auto debit, and no interest question', () => {
    render(
      <StartSavingsForm
        colors={Colors.light}
        controller={createStartSavingsController()}
      />
    );
    expect(
      screen.getByRole('radio', { name: 'Use auto debit for savings' })
    ).toBeOnTheScreen();
    expect(screen.queryByText('Earn interest on your savings?')).toBeNull();
  });

  it('has no all-caps headings or the old goal-set clutter', () => {
    render(
      <StartSavingsForm
        colors={Colors.light}
        controller={createStartSavingsController()}
      />
    );
    expect(screen.queryByText(/THE ONE YOU|YOUR SAVINGS TIMELINE/)).toBeNull();
    expect(screen.queryByText(/Your goal is set/)).toBeNull();
    expect(screen.getByText('Your savings timeline')).toBeOnTheScreen();
  });
});

describe('StartSavingsForm for a PiggyVest wallet', () => {
  it('asks about interest on the form and hides auto debit', () => {
    const controller = createPrimaryStartSavingsController();
    render(<StartSavingsForm colors={Colors.light} controller={controller} />);
    expect(
      screen.queryByRole('radio', { name: 'Use auto debit for savings' })
    ).toBeNull();
    fireEvent.press(screen.getByRole('radio', { name: 'Yes, earn interest' }));
    expect(controller.setInterestChoice).toHaveBeenCalledWith(true);
  });

  it('marks step 3 done once interest is answered and terms accepted', () => {
    render(
      <StartSavingsForm
        colors={Colors.light}
        controller={createPrimaryStartSavingsController({
          acceptsNonWithdrawableTerms: true,
          interestChoice: false,
        })}
      />
    );
    expect(
      screen.getByLabelText('Step 3, How you’ll save, done')
    ).toBeOnTheScreen();
  });
});
