import { fireEvent, render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import { SavingsPlanGettingReady } from './SavingsPlanGettingReady';

describe('SavingsPlanGettingReady with PiggyVest off', () => {
  it('says calmly that the plan is getting ready and the customer can leave', () => {
    render(<SavingsPlanGettingReady colors={Colors.light} />);
    expect(screen.getByText('Getting your plan ready')).toBeOnTheScreen();
    expect(screen.getByText(/You can leave this screen/)).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Check now' })).toBeNull();
    expect(screen.queryByText(/check back shortly/i)).toBeNull();
  });

  it('offers Check now once it is taking longer', () => {
    const onCheckNow = jest.fn();
    render(
      <SavingsPlanGettingReady
        colors={Colors.light}
        slow
        onCheckNow={onCheckNow}
      />
    );
    expect(
      screen.getByText(
        /Savings are running slowly right now\. Your money is safe\./
      )
    ).toBeOnTheScreen();
    fireEvent.press(screen.getByRole('button', { name: 'Check now' }));
    expect(onCheckNow).toHaveBeenCalled();
  });
});
