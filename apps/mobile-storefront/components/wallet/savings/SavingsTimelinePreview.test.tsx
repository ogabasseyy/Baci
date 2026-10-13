import { render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import { SavingsTimelinePreview } from './SavingsTimelinePreview';

describe('SavingsTimelinePreview', () => {
  it('updates the payment count and calendar estimate for a monthly amount', () => {
    render(
      <SavingsTimelinePreview
        colors={Colors.light}
        targetAmount={250000}
        contributionAmount={25000}
        frequency="monthly"
        maturityDate="2027-06-01"
        initialContributionEnabled={false}
      />
    );

    expect(screen.getByText('10 monthly contributions')).toBeOnTheScreen();
    expect(screen.getByText(/About 9 months/)).toBeOnTheScreen();
    expect(screen.getByText(/Estimated completion/)).toBeOnTheScreen();
  });

  it('does not show a misleading timeline before a valid amount is entered', () => {
    render(
      <SavingsTimelinePreview
        colors={Colors.light}
        targetAmount={250000}
        contributionAmount={0}
        frequency="monthly"
        maturityDate=""
        initialContributionEnabled={false}
      />
    );

    expect(screen.queryByText(/contributions/)).toBeNull();
    expect(screen.queryByText(/Estimated completion/)).toBeNull();
  });

  it('clarifies that the upfront payment is excluded from the schedule estimate', () => {
    render(
      <SavingsTimelinePreview
        colors={Colors.light}
        targetAmount={250000}
        contributionAmount={25000}
        frequency="monthly"
        maturityDate="2027-06-01"
        initialContributionEnabled
      />
    );

    expect(
      screen.getByText('Estimate excludes your upfront contribution.')
    ).toBeOnTheScreen();
  });
});
