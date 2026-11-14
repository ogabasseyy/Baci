import { render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';
import Colors from '@/constants/Colors';
import { SavingsStep } from './SavingsStep';

describe('SavingsStep with PiggyVest off', () => {
  it('shows the content of the current and done steps', () => {
    render(
      <SavingsStep
        colors={Colors.light}
        number={1}
        title="Pick"
        state="current"
      >
        <Text>Body</Text>
      </SavingsStep>
    );
    expect(
      screen.getByLabelText('Step 1, Pick, current step')
    ).toBeOnTheScreen();
    expect(screen.getByText('Body')).toBeOnTheScreen();
  });

  it('shows only the title of a later step', () => {
    render(
      <SavingsStep
        colors={Colors.light}
        number={3}
        title="Later"
        state="later"
        last
      >
        <Text>Hidden</Text>
      </SavingsStep>
    );
    expect(
      screen.getByLabelText('Step 3, Later, not started')
    ).toBeOnTheScreen();
    expect(screen.queryByText('Hidden')).toBeNull();
  });

  it('replaces the number with a tick when done', () => {
    render(
      <SavingsStep colors={Colors.light} number={2} title="Done" state="done" />
    );
    expect(screen.queryByText('2')).toBeNull();
  });

  it('shows the encouraging line once the step is open, not before', () => {
    const { rerender } = render(
      <SavingsStep
        colors={Colors.light}
        number={1}
        title="Pick"
        state="later"
        icon="phone-portrait-outline"
        cheer="Every saving gets you closer."
      />
    );
    expect(screen.queryByText('Every saving gets you closer.')).toBeNull();
    rerender(
      <SavingsStep
        colors={Colors.light}
        number={1}
        title="Pick"
        state="current"
        icon="phone-portrait-outline"
        cheer="Every saving gets you closer."
      />
    );
    expect(screen.getByText('Every saving gets you closer.')).toBeOnTheScreen();
  });
});
