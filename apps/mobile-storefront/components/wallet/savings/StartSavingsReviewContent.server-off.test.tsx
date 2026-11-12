import { fireEvent, render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import { StartSavingsReviewContent } from './StartSavingsReviewContent';
import {
  createPrimaryStartSavingsController,
  createStartSavingsController,
} from './start-savings-controller.test-support';

describe('StartSavingsReviewContent with PiggyVest off', () => {
  it('reviews the plan in the plan’s own pace and creates it in one step', () => {
    const controller = createStartSavingsController();
    render(
      <StartSavingsReviewContent
        colors={Colors.light}
        controller={controller}
      />
    );
    expect(screen.getByText('Check your plan')).toBeOnTheScreen();
    expect(screen.getByText('₦2,000 a day')).toBeOnTheScreen();
    expect(screen.queryByText(/Next: choose how to fund/)).toBeNull();
    fireEvent.press(screen.getByRole('button', { name: 'Create my plan' }));
    expect(controller.handleFundingContinue).toHaveBeenCalledTimes(1);
  });

  describe('bugfix: a ₦0 head start was asked how to pay', () => {
    it('shows no payment choice when there is no head start', () => {
      render(
        <StartSavingsReviewContent
          colors={Colors.light}
          controller={createStartSavingsController()}
        />
      );
      expect(screen.queryByText('Pay your head start with')).toBeNull();
      expect(screen.queryByText('Pay with bank transfer')).toBeNull();
    });
  });

  it('asks how to pay a real head start on the old wallet', () => {
    render(
      <StartSavingsReviewContent
        colors={Colors.light}
        controller={createStartSavingsController({
          effectiveInitialContribution: 5000,
          initialContributionEnabled: true,
        })}
      />
    );
    expect(screen.getByText('Pay your head start with')).toBeOnTheScreen();
    expect(screen.getByText('₦5,000')).toBeOnTheScreen();
  });
});

describe('StartSavingsReviewContent for a PiggyVest wallet', () => {
  it('never asks how to pay, and shows the interest answer', () => {
    render(
      <StartSavingsReviewContent
        colors={Colors.light}
        controller={createPrimaryStartSavingsController({
          effectiveInitialContribution: 5000,
          initialContributionEnabled: true,
          interestChoice: true,
        })}
      />
    );
    expect(screen.queryByText('Pay your head start with')).toBeNull();
    expect(screen.getByText('Earns interest')).toBeOnTheScreen();
    expect(screen.getByText('Yes')).toBeOnTheScreen();
  });
});
