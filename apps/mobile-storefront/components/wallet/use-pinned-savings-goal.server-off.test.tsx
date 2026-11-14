import { renderHook } from '@testing-library/react-native';
import type { WalletActiveSavingsGoal } from '@/hooks/wallet-query';
import { usePinnedSavingsGoal } from './use-pinned-savings-goal';

const goal = (
  id: string,
  over: Partial<WalletActiveSavingsGoal> = {}
): WalletActiveSavingsGoal => ({
  contribution_amount: 1000,
  contribution_frequency: 'monthly',
  current_amount: 1000,
  id,
  maturity_date: '2027-01-01',
  source_mode: 'manual',
  status: 'active',
  target_amount: 10000,
  title: id,
  ...over,
});

type Props = {
  open: boolean;
  route?: string;
  shown?: WalletActiveSavingsGoal;
};

function render(initial: Props) {
  return renderHook(
    ({ open, route, shown }: Props) => {
      const pin = usePinnedSavingsGoal(open, route);
      pin.noteShown(shown);
      return pin;
    },
    { initialProps: initial }
  );
}

// Local selection state only: nothing here needs PiggyVest.
describe('server keeps PiggyVest off: usePinnedSavingsGoal', () => {
  it('keeps the sheet on the goal it opened on while it stays open', () => {
    const { result, rerender } = render({ open: true, shown: goal('goal-a') });
    rerender({ open: true, shown: goal('goal-a') });
    expect(result.current.goalId).toBe('goal-a');
    // The wallet keeps showing the pinned goal (it asks for it by id), even
    // after a refresh that would otherwise promote another active goal.
    rerender({ open: true, shown: goal('goal-a', { current_amount: 9000 }) });
    expect(result.current.goalId).toBe('goal-a');
  });

  it('keeps the pin across a close and reopen', () => {
    const { result, rerender } = render({ open: true, shown: goal('goal-a') });
    rerender({ open: true, shown: goal('goal-a') });
    rerender({ open: false, shown: goal('goal-a') });
    rerender({ open: true, shown: goal('goal-a') });
    expect(result.current.goalId).toBe('goal-a');
  });

  it('releases the pin when the pinned goal leaves the list', () => {
    const { result, rerender } = render({ open: true, shown: goal('goal-a') });
    rerender({ open: true, shown: goal('goal-a') });
    // The wallet fell back to another goal: goal A is gone.
    rerender({ open: false, shown: goal('goal-b') });
    rerender({ open: false, shown: goal('goal-b') });
    expect(result.current.goalId).toBeUndefined();
  });

  it('releases the pin once the completed goal has settled', () => {
    const settled = goal('goal-a', {
      status: 'completed',
      current_amount: 0,
      principal_amount: 0,
    });
    const { result, rerender } = render({ open: true, shown: goal('goal-a') });
    rerender({ open: true, shown: goal('goal-a') });
    rerender({ open: false, shown: settled });
    rerender({ open: false, shown: settled });
    expect(result.current.goalId).toBeUndefined();
  });

  it('keeps a just-completed goal that still holds money pinned after closing', () => {
    const done = goal('goal-a', {
      status: 'completed',
      current_amount: 10000,
      principal_amount: 10000,
    });
    const { result, rerender } = render({ open: true, shown: goal('goal-a') });
    rerender({ open: true, shown: done });
    rerender({ open: false, shown: done });
    rerender({ open: false, shown: done });
    expect(result.current.goalId).toBe('goal-a');
  });

  it('settles into one pin when the sheet opens on a settled goal (no update loop)', () => {
    const settled = goal('goal-a', {
      status: 'completed',
      current_amount: 0,
      principal_amount: 0,
    });
    const { result, rerender } = render({
      open: true,
      route: 'goal-a',
      shown: settled,
    });
    rerender({ open: true, route: 'goal-a', shown: settled });
    rerender({ open: true, route: 'goal-a', shown: settled });
    expect(result.current.goalId).toBe('goal-a');
  });

  it('keeps a goal that settles while its sheet is open until the sheet closes', () => {
    const settled = goal('goal-a', {
      status: 'completed',
      current_amount: 0,
      principal_amount: 0,
    });
    const { result, rerender } = render({ open: true, shown: goal('goal-a') });
    rerender({ open: true, shown: goal('goal-a') });
    // Complete goal paid out: the sheet is on its "Request sent" step.
    rerender({ open: true, shown: settled });
    rerender({ open: true, shown: settled });
    expect(result.current.goalId).toBe('goal-a');
    rerender({ open: false, shown: settled });
    rerender({ open: false, shown: settled });
    expect(result.current.goalId).toBeUndefined();
  });

  it('lets a goal named by the route win', () => {
    const { result } = render({
      open: true,
      route: 'goal-r',
      shown: goal('goal-a'),
    });
    expect(result.current.goalId).toBe('goal-r');
    expect(result.current.routeGoalId).toBe('goal-r');
  });
});
