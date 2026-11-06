import { render, screen } from '@testing-library/react-native';
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

  it('replaces the flat zero state with encouragement and a weekly pace', () => {
    render(<SavingsGoalSummary colors={Colors.dark} goal={goal} />);
    expect(screen.getByText('Every naira counts')).toBeOnTheScreen();
    expect(screen.getByText('Start with any amount.')).toBeOnTheScreen();
    expect(screen.getByText('₦0 saved')).toBeOnTheScreen();
    expect(screen.getByText('₦250,000 target')).toBeOnTheScreen();
    expect(screen.queryByText(/no image/i)).toBeNull();
    expect(
      screen.getByText(/^Save about ₦62,500 a week to reach this by /)
    ).toBeOnTheScreen();
  });

  it('skips the pace line when the goal has no usable future date', () => {
    render(
      <SavingsGoalSummary
        colors={Colors.light}
        goal={{ ...goal, maturity_date: '' }}
      />
    );
    expect(screen.queryByText(/a week to reach this by/)).toBeNull();
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
    expect(screen.queryByText(/a week to reach this by/)).toBeNull();
  });
});
