import { render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import Colors from '@/constants/Colors';
import type { WalletActiveSavingsGoal } from '@/hooks/wallet-query';
import { SavingsGoalSummary } from './SavingsGoalSummary';

jest.mock('expo-image', () => ({ Image: () => null }));

const goal: WalletActiveSavingsGoal = {
  contribution_amount: 500,
  contribution_frequency: 'weekly',
  current_amount: 0,
  id: 'goal-1',
  maturity_date: '2026-12-03',
  product_image: null,
  source_mode: 'manual',
  status: 'active',
  target_amount: 250000,
  title: 'Synthetic phone',
};

describe('SavingsGoalSummary', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: new Date('2026-11-05T10:00:00Z') });
  });
  afterEach(() => jest.useRealTimers());

  it('hides the progress card until something is saved, keeping the weekly pace', () => {
    render(<SavingsGoalSummary colors={Colors.dark} goal={goal} />);
    expect(screen.queryByText('YOUR PROGRESS')).toBeNull();
    expect(screen.queryByText('₦0 saved')).toBeNull();
    expect(screen.queryByText('Every naira counts')).toBeNull();
    expect(screen.queryByText(/no image/i)).toBeNull();
    // Saved-of-target and the weekly pace side by side, read as one.
    expect(
      screen.getByLabelText(
        /^₦0 of ₦250,000 saved\. ₦62,500 a week to finish by /
      )
    ).toBeOnTheScreen();
    expect(
      screen.getByText('₦62,500 a week · until 3 Dec 2026')
    ).toBeOnTheScreen();
    expect(screen.getByText('₦0 of ₦250,000')).toBeOnTheScreen();
    expect(screen.queryByText('SAVING TOWARDS')).toBeNull();
  });

  it('uses the compact condition, capacity and colour arrangement', () => {
    render(
      <SavingsGoalSummary
        colors={Colors.dark}
        goal={{
          ...goal,
          product_condition: 'used',
          product_variant_label: 'Color: Black · Storage: 256GB',
        }}
      />
    );
    expect(screen.getByLabelText('Device condition: Used')).toBeOnTheScreen();
    expect(screen.getByText('256GB')).toBeOnTheScreen();
    expect(
      screen.getByRole('image', { name: 'Device colour: Black' })
    ).toBeOnTheScreen();
    expect(screen.queryByText(/Condition:|Storage:|Color:/)).toBeNull();
  });

  it('shows the progress card once something is saved', () => {
    render(
      <SavingsGoalSummary
        colors={Colors.dark}
        goal={{ ...goal, current_amount: 400 }}
      />
    );
    expect(screen.getByText('YOUR PROGRESS')).toBeOnTheScreen();
    expect(screen.getByText('₦400 saved')).toBeOnTheScreen();
    expect(screen.getByText('₦250,000 target')).toBeOnTheScreen();
  });

  it('lets the saved and target labels shrink inside their row', () => {
    render(
      <SavingsGoalSummary
        colors={Colors.light}
        goal={{ ...goal, current_amount: 400 }}
      />
    );
    expect(
      StyleSheet.flatten(screen.getByText('₦400 saved').props.style)
    ).toMatchObject({ flexShrink: 1 });
    expect(
      StyleSheet.flatten(screen.getByText('₦250,000 target').props.style)
    ).toMatchObject({ flexShrink: 1 });
  });

  it('skips the pace line when the goal has no usable future date', () => {
    render(
      <SavingsGoalSummary
        colors={Colors.light}
        goal={{ ...goal, maturity_date: '' }}
      />
    );
    expect(screen.queryByText(/a week to finish by/)).toBeNull();
    // No blank gap: with no pace, the zero-saved status shows alone.
    expect(screen.getByLabelText('₦0 of ₦250,000 saved')).toBeOnTheScreen();
    expect(screen.queryByText(/\/week|due by/)).toBeNull();
  });

  it.each([
    [62500, 'A quarter of the way!'],
    [125000, 'Halfway there!'],
    [190000, 'Almost there!'],
  ])('cheers progress at %i saved', (current, title) => {
    render(
      <SavingsGoalSummary
        colors={Colors.light}
        goal={{ ...goal, current_amount: current }}
      />
    );
    expect(screen.getByText(title)).toBeOnTheScreen();
  });

  it('acknowledges ₦400 saved toward ₦250,000 without rounding the meter up', () => {
    render(
      <SavingsGoalSummary
        colors={Colors.light}
        goal={{ ...goal, current_amount: 400 }}
      />
    );

    expect(screen.getByText('Your plan is growing')).toBeOnTheScreen();
    expect(
      screen.getByText('Small steps add up. Keep it going.')
    ).toBeOnTheScreen();
    expect(screen.queryByText('Every naira counts')).toBeNull();
    expect(screen.getByText(/<1% complete/)).toBeOnTheScreen();
    expect(
      screen.getByRole('progressbar', { name: 'Savings plan progress details' })
    ).toHaveAccessibilityValue({ now: 0 });
  });

  it('celebrates a finished goal and drops the pace line', () => {
    render(
      <SavingsGoalSummary
        colors={Colors.light}
        goal={{ ...goal, current_amount: 250000, status: 'completed' }}
      />
    );
    expect(screen.getByText('Goal reached!')).toBeOnTheScreen();
    expect(screen.queryByText(/a week to finish by/)).toBeNull();
  });
});
