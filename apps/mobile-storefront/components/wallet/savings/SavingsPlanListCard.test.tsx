import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import Colors from '@/constants/Colors';
import type { WalletActiveSavingsGoal } from '@/hooks/wallet-query';
import { SavingsPlanListCard } from './SavingsPlanListCard';

const goal: WalletActiveSavingsGoal = {
  id: 'phone',
  title: 'New phone',
  current_amount: 100,
  target_amount: 250000,
  status: 'active',
  contribution_amount: 100,
  contribution_frequency: 'monthly',
  maturity_date: '2027-10-12',
  source_mode: 'manual',
};

it('shows small positive progress without pretending the plan is empty', () => {
  const onPress = jest.fn();
  render(
    <SavingsPlanListCard goal={goal} colors={Colors.dark} onPress={onPress} />
  );
  expect(screen.getByText('<1%')).toBeTruthy();
  expect(screen.getByText('₦100')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Open New phone' })).toHaveStyle({
    padding: 20,
    borderWidth: 1,
    borderRadius: 24,
    backgroundColor: Colors.dark.card,
  });
  expect(screen.getByRole('button', { name: 'Open New phone' })).toHaveStyle({
    padding: 20,
    borderWidth: 1,
    borderRadius: 24,
    backgroundColor: Colors.dark.card,
  });
  fireEvent.press(screen.getByRole('button', { name: 'Open New phone' }));
  expect(onPress).toHaveBeenCalledTimes(1);
});

it('clamps an overfunded completed plan to 100 percent with nothing left', () => {
  render(
    <SavingsPlanListCard
      goal={{ ...goal, current_amount: 300000, status: 'completed' }}
      colors={Colors.dark}
      onPress={jest.fn()}
    />
  );
  expect(screen.getByText('100%')).toBeTruthy();
  expect(screen.getByText('₦0 to go')).toBeTruthy();
  expect(screen.getByText('Completed')).toBeTruthy();
});

it('handles a zero target without invalid progress', () => {
  render(
    <SavingsPlanListCard
      goal={{ ...goal, target_amount: 0 }}
      colors={Colors.light}
      onPress={jest.fn()}
    />
  );
  expect(screen.getByText('0%')).toBeTruthy();
});

it.each([
  [0, 0, '0%'],
  [100, 0.04, '<1%'],
  [2000, 0.8, '<1%'],
  [250000, 100, '100%'],
])('announces %s saved with its visible label and actual numeric fill', (amount, percent, label) => {
  const title = 'A very long savings device name with storage and colour';
  render(
    <SavingsPlanListCard
      goal={{ ...goal, title, current_amount: amount }}
      colors={Colors.dark}
      onPress={jest.fn()}
    />
  );

  const progress = screen.getByLabelText(`${title} progress`);
  expect(progress).toHaveAccessibilityValue({ now: percent, text: label });
  expect(StyleSheet.flatten(progress.props.children.props.style)).toEqual(
    expect.objectContaining({ width: `${percent}%` })
  );
  expect(screen.getByText(label)).toBeOnTheScreen();
});

it('keeps a long savings device name on one line with a trailing ellipsis', () => {
  const title = 'A very long savings device name with storage and colour';
  render(
    <SavingsPlanListCard
      goal={{ ...goal, title }}
      colors={Colors.dark}
      onPress={jest.fn()}
    />
  );

  expect(screen.getByText(title)).toHaveProp('numberOfLines', 1);
  expect(screen.getByText(title)).toHaveProp('ellipsizeMode', 'tail');
});
