import { renderHook } from '@testing-library/react-native';
import { usePinnedSavingsGoal } from './use-pinned-savings-goal';

type Props = { open: boolean; route?: string; shown?: string };

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
    const { result, rerender } = render({ open: true, shown: 'goal-a' });
    rerender({ open: true, shown: 'goal-a' });
    expect(result.current.goalId).toBe('goal-a');
    // The completed goal would otherwise give way to another active goal.
    rerender({ open: true, shown: 'goal-b' });
    expect(result.current.goalId).toBe('goal-a');
  });

  it('releases the pin when the sheet closes', () => {
    const { result, rerender } = render({ open: true, shown: 'goal-a' });
    rerender({ open: true, shown: 'goal-a' });
    rerender({ open: false, shown: 'goal-b' });
    expect(result.current.goalId).toBeUndefined();
  });

  it('lets a goal named by the route win', () => {
    const { result } = render({ open: true, route: 'goal-r', shown: 'goal-a' });
    expect(result.current.goalId).toBe('goal-r');
    expect(result.current.routeGoalId).toBe('goal-r');
  });
});
