import { fireEvent, render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import { SavingsContributionSection } from './SavingsContributionSection';
import { createStartSavingsController } from './start-savings-controller.test-support';

describe('SavingsContributionSection with PiggyVest off', () => {
  it('shows the timeline and filled head-start cards', () => {
    const controller = createStartSavingsController();
    render(
      <SavingsContributionSection
        colors={Colors.light}
        controller={controller}
      />
    );
    expect(screen.getByText('Your savings timeline')).toBeOnTheScreen();
    expect(
      screen.getByRole('radio', { name: 'Initial contribution No' })
    ).toBeSelected();
    fireEvent.press(
      screen.getByRole('radio', { name: 'Initial contribution Yes' })
    );
    expect(controller.setInitialContributionEnabled).toHaveBeenCalledWith(true);
  });

  describe('bugfix: ₦82,000,000 a day was accepted for a ₦250,000 phone', () => {
    it('warns as soon as the amount is more than the target', () => {
      render(
        <SavingsContributionSection
          colors={Colors.light}
          controller={createStartSavingsController({
            contributionAmount: '82000000',
            contributionValue: 82_000_000,
          })}
        />
      );
      expect(
        screen.getByText(/can’t be more than the phone’s price/)
      ).toBeOnTheScreen();
      expect(screen.queryByText('Your savings timeline')).toBeNull();
    });
  });

  describe('bugfix: a head start above the price hid Continue with no reason given', () => {
    it('says why when the head start is more than the phone’s price', () => {
      render(
        <SavingsContributionSection
          colors={Colors.light}
          controller={createStartSavingsController({
            initialContributionEnabled: true,
            initialContributionAmount: '300000',
            effectiveInitialContribution: 300_000,
          })}
        />
      );
      expect(
        screen.getByText('Your head start cannot be more than the plan target.')
      ).toBeOnTheScreen();
    });

    it('says nothing for a head start within the price', () => {
      render(
        <SavingsContributionSection
          colors={Colors.light}
          controller={createStartSavingsController({
            initialContributionEnabled: true,
            initialContributionAmount: '50000',
            effectiveInitialContribution: 50_000,
          })}
        />
      );
      expect(screen.queryByText(/head start cannot be more/)).toBeNull();
    });
  });
});
