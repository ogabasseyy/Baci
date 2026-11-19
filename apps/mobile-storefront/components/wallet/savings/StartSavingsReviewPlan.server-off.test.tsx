import { render, screen } from '@testing-library/react-native';
import { formatDateTimeDisplay } from '@/components/ui/format-date-time-display';
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
    expect(screen.getByText("It's yours in about 125 days")).toBeOnTheScreen();
    expect(screen.getByText('Start')).toBeOnTheScreen();
    expect(screen.getByText("It's yours")).toBeOnTheScreen();
    expect(
      screen.getByText('Pay from your wallet, whenever you like')
    ).toBeOnTheScreen();
    // The legacy wallet asks no interest question.
    expect(screen.queryByText(/interest/i)).toBeNull();
  });

  describe('bugfix: a long plan read "Yours in about 15188 days"', () => {
    it('says years for a plan over two years', () => {
      render(
        <StartSavingsReviewPlan
          colors={Colors.light}
          controller={createStartSavingsController({
            contributionValue: 500,
            startDate: '2026-11-12',
            maturityDate: '2068-06-15',
          })}
        />
      );
      expect(
        screen.getByText("It's yours in about 42 years")
      ).toBeOnTheScreen();
      expect(screen.queryByText(/days/)).toBeNull();
    });

    it('says months for a plan between six months and two years', () => {
      render(
        <StartSavingsReviewPlan
          colors={Colors.light}
          controller={createStartSavingsController({
            contributionValue: 25000,
            startDate: '2026-11-12',
            maturityDate: '2027-09-12',
          })}
        />
      );
      expect(
        screen.getByText("It's yours in about 10 months")
      ).toBeOnTheScreen();
    });
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
      expect(screen.getByText("It's yours in about 34 days")).toBeOnTheScreen();
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
      expect(screen.getByText("It's yours today")).toBeOnTheScreen();
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
      expect(screen.getByText("It's yours today")).toBeOnTheScreen();
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
          "It's yours in about 125 days, not counting your head start"
        )
      ).toBeOnTheScreen();
    });
  });

  describe('bugfix: a fully funded head start showed the phone both today and later', () => {
    it('dates "Your phone" today when the head start covers the whole price', () => {
      render(
        <StartSavingsReviewPlan
          colors={Colors.light}
          controller={createStartSavingsController({
            initialContributionEnabled: true,
            initialContributionAmount: '250000',
            effectiveInitialContribution: 250_000,
            startDate: '2026-11-20',
            maturityDate: '2027-03-16',
          })}
        />
      );
      const today = formatDateTimeDisplay('2026-11-12', 'date');
      const later = formatDateTimeDisplay('2027-03-16', 'date');
      expect(screen.getByText("It's yours today")).toBeOnTheScreen();
      // Start and phone both today: never a later start before its end.
      expect(screen.getAllByText(today)).toHaveLength(2);
      expect(screen.queryByText(later)).toBeNull();
      expect(
        screen.queryByText(formatDateTimeDisplay('2026-11-20', 'date'))
      ).toBeNull();
    });
  });

  describe('bugfix: a bank-transfer head start said "Yours today" before any money moved', () => {
    it('does not count a head start that is still to be paid by transfer', () => {
      render(
        <StartSavingsReviewPlan
          colors={Colors.light}
          controller={createStartSavingsController({
            initialContributionEnabled: true,
            initialContributionAmount: '250000',
            effectiveInitialContribution: 250_000,
            selectedFundingOption: 'bank_transfer',
            startDate: '2026-11-12',
            maturityDate: '2027-03-16',
          })}
        />
      );
      expect(screen.queryByText("It's yours today")).toBeNull();
      expect(
        screen.getByText(formatDateTimeDisplay('2027-03-16', 'date'))
      ).toBeOnTheScreen();
    });
  });

  describe('bugfix: a PiggyVest head start said "Yours today" before the PIN payment', () => {
    it('does not count a head start still to be paid from the PiggyVest wallet', () => {
      render(
        <StartSavingsReviewPlan
          colors={Colors.light}
          controller={createStartSavingsController({
            primaryWallet: true,
            initialContributionEnabled: true,
            initialContributionAmount: '250000',
            effectiveInitialContribution: 250_000,
            startDate: '2026-11-12',
            maturityDate: '2027-03-16',
          })}
        />
      );
      expect(screen.queryByText("It's yours today")).toBeNull();
      expect(
        screen.getByText(formatDateTimeDisplay('2027-03-16', 'date'))
      ).toBeOnTheScreen();
    });
  });
});
