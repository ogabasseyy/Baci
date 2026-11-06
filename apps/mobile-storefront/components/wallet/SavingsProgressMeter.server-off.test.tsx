import { render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import { SavingsProgressMeter } from './SavingsProgressMeter';

describe('SavingsProgressMeter', () => {
  it('exposes the percentage as a progress bar', () => {
    render(
      <SavingsProgressMeter
        accessibilityLabel="Savings plan progress"
        colors={Colors.light}
        percent={40}
      />
    );
    expect(
      screen.getByRole('progressbar', { name: 'Savings plan progress' })
    ).toHaveAccessibilityValue({ max: 100, min: 0, now: 40 });
  });

  it('follows a new value when progress changes', () => {
    const { rerender } = render(
      <SavingsProgressMeter
        accessibilityLabel="Progress"
        colors={Colors.dark}
        percent={0}
      />
    );
    rerender(
      <SavingsProgressMeter
        accessibilityLabel="Progress"
        colors={Colors.dark}
        percent={100}
      />
    );
    expect(
      screen.getByRole('progressbar', { name: 'Progress' })
    ).toHaveAccessibilityValue({ now: 100 });
  });
});
