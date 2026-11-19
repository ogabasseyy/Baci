import { render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import { SavingsContributionSection } from './SavingsContributionSection';
import { createStartSavingsController } from './start-savings-controller.test-support';

function renderWith(maturityDate: string) {
  render(
    <SavingsContributionSection
      colors={Colors.light}
      controller={createStartSavingsController({ maturityDate })}
    />
  );
}

describe('SavingsContributionSection long-plan note', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: new Date('2026-11-16T10:00:00Z') });
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('bugfix: nudges toward a bigger amount when the plan takes about 42 years', () => {
    renderWith('2068-11-16');
    expect(
      screen.getByText(
        'This plan takes about 42 years. Saving more each time gets you the phone sooner.'
      )
    ).toBeOnTheScreen();
    // Not a blocker: the timeline stays.
    expect(screen.getByText('Your savings timeline')).toBeOnTheScreen();
  });

  it('says nothing for a plan of two years or less', () => {
    renderWith('2028-11-15');
    expect(screen.queryByText(/Saving more each time/)).toBeNull();
  });

  it('bugfix: says nothing for exactly two years across a leap day (Muse)', () => {
    // 2026-11-16 to 2028-11-16 is 731 days (29 February 2028).
    renderWith('2028-11-16');
    expect(screen.queryByText(/Saving more each time/)).toBeNull();
  });

  it('says nothing when the end date is unknown', () => {
    renderWith('');
    expect(screen.queryByText(/Saving more each time/)).toBeNull();
  });
});
