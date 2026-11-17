import { render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import { SavingsContributionProgress } from './SavingsContributionProgress';

// Pure presentation: it never calls a server, so PiggyVest on or off is the same.
describe('SavingsContributionProgress', () => {
  it('says how much is moving, with a spinner', () => {
    render(<SavingsContributionProgress amount={100} colors={Colors.light} />);
    expect(
      screen.getByLabelText('Moving ₦100 into your plan…')
    ).toBeOnTheScreen();
    expect(screen.getByText('Moving ₦100 into your plan…')).toBeOnTheScreen();
  });

  it('still reads clearly without an amount', () => {
    render(<SavingsContributionProgress colors={Colors.dark} />);
    expect(
      screen.getByText('Moving your money into your plan…')
    ).toBeOnTheScreen();
  });
});
