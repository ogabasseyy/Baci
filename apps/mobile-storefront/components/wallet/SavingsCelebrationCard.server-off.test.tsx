import { render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import { SavingsCelebrationCard } from './SavingsCelebrationCard';

describe('SavingsCelebrationCard', () => {
  it('cheers the amount added and the progress so far', () => {
    render(
      <SavingsCelebrationCard
        celebration={{ added: 5000, percent: 42 }}
        colors={Colors.light}
      />
    );
    expect(
      screen.getByText("Nice! ₦5,000 added. You're 42% there.")
    ).toBeOnTheScreen();
  });

  it('celebrates reaching the goal', () => {
    render(
      <SavingsCelebrationCard
        celebration={{ added: 1000, percent: 100 }}
        colors={Colors.dark}
      />
    );
    expect(
      screen.getByText('Goal reached! ₦1,000 added. You did it.')
    ).toBeOnTheScreen();
  });
});
