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
    expect(screen.getByText(/taking longer than usual/)).toBeOnTheScreen();
    // The shared notice carries the slowdown message; the card never repeats it.
    expect(screen.queryByText(/running slowly/)).toBeNull();
    fireEvent.press(screen.getByRole('button', { name: 'Check now' }));
    expect(onCheckNow).toHaveBeenCalled();
  });

  describe('bugfix: the card promised checks after they had paused', () => {
    it('says so and points to Check now once the checks have paused', () => {
      render(
        <SavingsPlanGettingReady
          colors={Colors.light}
          slow
          paused
          onCheckNow={jest.fn()}
        />
      );
      expect(
        screen.getByText(/Tap Check now to see if it’s ready/)
      ).toBeOnTheScreen();
      expect(screen.queryByText(/We’ll keep going/)).toBeNull();
    });
  });
});
