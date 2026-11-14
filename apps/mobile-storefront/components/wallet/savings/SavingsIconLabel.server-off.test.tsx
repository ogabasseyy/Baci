import { render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import { SavingsIconLabel } from './SavingsIconLabel';

describe('SavingsIconLabel with PiggyVest off', () => {
  it('shows its text as a label or a note', () => {
    render(
      <>
        <SavingsIconLabel
          icon="rocket-outline"
          text="Want to give it a head start?"
          color={Colors.light.text}
        />
        <SavingsIconLabel
          icon="information-circle-outline"
          text="A note"
          color={Colors.light.textSecondary}
          variant="note"
        />
      </>
    );
    expect(screen.getByText('Want to give it a head start?')).toBeOnTheScreen();
    expect(screen.getByText('A note')).toBeOnTheScreen();
  });
});
