import { render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import { StartSavingsReviewPlan } from './StartSavingsReviewPlan';
import { createStartSavingsController } from './start-savings-controller.test-support';

jest.mock('expo-image', () => ({ Image: () => null }));

describe('StartSavingsReviewPlan with PiggyVest off', () => {
  it('shows the phone, the pace headline, the timeline and how it works', () => {
    render(
      <StartSavingsReviewPlan
        colors={Colors.light}
        controller={createStartSavingsController()}
      />
    );
    expect(screen.getByText('Sandbox Test Phone')).toBeOnTheScreen();
    expect(screen.getByText('₦250,000 goal')).toBeOnTheScreen();
    expect(screen.getByText('₦2,000 a day')).toBeOnTheScreen();
    expect(screen.getByText('Yours in about 124 days')).toBeOnTheScreen();
    expect(screen.getByText('Start')).toBeOnTheScreen();
    expect(screen.getByText('Your phone')).toBeOnTheScreen();
    expect(
      screen.getByText('From your wallet, whenever you like')
    ).toBeOnTheScreen();
    // The legacy wallet asks no interest question.
    expect(screen.queryByText(/interest/i)).toBeNull();
  });

  describe('bugfix: "Yours today" was shown for a future start date', () => {
    it('names the start date when one payment covers the target later', () => {
      render(
        <StartSavingsReviewPlan
          colors={Colors.light}
          controller={createStartSavingsController({
            contributionValue: 250000,
            startDate: '2099-01-15',
            maturityDate: '2099-01-15',
          })}
        />
      );
      expect(screen.queryByText('Yours today')).toBeNull();
      expect(screen.getByText(/^Yours on /)).toBeOnTheScreen();
    });
  });
});
