import { render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import { StartSavingsReviewPlan } from './StartSavingsReviewPlan';
import { createStartSavingsController } from './start-savings-controller.test-support';

jest.mock('expo-image', () => ({ Image: () => null }));

describe('StartSavingsReviewPlan with PiggyVest off', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: new Date(2026, 10, 12, 10) });
  });
  afterEach(() => jest.useRealTimers());

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
    expect(screen.getByText('Yours in about 125 days')).toBeOnTheScreen();
    expect(screen.getByText('Start')).toBeOnTheScreen();
    expect(screen.getByText('Your phone')).toBeOnTheScreen();
    expect(
      screen.getByText('From your wallet, whenever you like')
    ).toBeOnTheScreen();
    // The legacy wallet asks no interest question.
    expect(screen.queryByText(/interest/i)).toBeNull();
  });

  describe('bugfix: the "Yours in" line ignored a later start date', () => {
    it('counts from today to the end date, including the wait to start', () => {
      render(
        <StartSavingsReviewPlan
          colors={Colors.light}
          controller={createStartSavingsController({
            contributionValue: 50000,
            startDate: '2026-12-12',
            maturityDate: '2026-12-16',
          })}
        />
      );
      // 5 daily payments starting in a month: about 34 days, not 4.
      expect(screen.getByText('Yours in about 34 days')).toBeOnTheScreen();
    });

    it('says today only when the plan ends today', () => {
      render(
        <StartSavingsReviewPlan
          colors={Colors.light}
          controller={createStartSavingsController({
            contributionValue: 250000,
            startDate: '2026-11-12',
            maturityDate: '2026-11-12',
          })}
        />
      );
      expect(screen.getByText('Yours today')).toBeOnTheScreen();
    });
  });
  describe('bugfix: the review date ignored the head start', () => {
    it('says today when the head start covers the whole phone', () => {
      render(
        <StartSavingsReviewPlan
          colors={Colors.light}
          controller={createStartSavingsController({
            effectiveInitialContribution: 250000,
          })}
        />
      );
      expect(screen.getByText('Yours today')).toBeOnTheScreen();
    });

    it('says the estimate does not count a partial head start', () => {
      render(
        <StartSavingsReviewPlan
          colors={Colors.light}
          controller={createStartSavingsController({
            effectiveInitialContribution: 50000,
          })}
        />
      );
      expect(
        screen.getByText(
          'Yours in about 125 days, not counting your head start'
        )
      ).toBeOnTheScreen();
    });
  });
});
