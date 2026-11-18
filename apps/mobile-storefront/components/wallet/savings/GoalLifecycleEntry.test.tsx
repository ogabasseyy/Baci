import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import Colors from '@/constants/Colors';
import type { WalletActiveSavingsGoal } from '@/hooks/wallet-query';
import { GoalLifecycleEntry } from './GoalLifecycleEntry';
import { usePrimaryGoalGate } from './use-primary-goal-gate';

jest.mock('./use-primary-goal-gate');

function makeGoal(over: Partial<WalletActiveSavingsGoal> = {}) {
  return {
    id: 'goal-1',
    title: 'iPhone',
    status: 'active',
    current_amount: 1000,
    target_amount: 5000,
    maturity_date: '2999-01-01',
    source_mode: 'manual',
    contribution_amount: 100,
    contribution_frequency: 'weekly',
    ...over,
  } as WalletActiveSavingsGoal;
}
const mockOnCancel = jest.fn();
const mockOnComplete = jest.fn();
function renderEntry(
  goal: WalletActiveSavingsGoal,
  hasPendingContribution = false
) {
  render(
    <GoalLifecycleEntry
      colors={Colors.light}
      goal={goal}
      hasPendingContribution={hasPendingContribution}
      onCancel={mockOnCancel}
      onComplete={mockOnComplete}
    />
  );
}
const cancel = () =>
  screen.queryByRole('button', { name: 'Cancel savings goal' });
const complete = () =>
  screen.queryByRole('button', { name: 'Complete savings goal' });

beforeEach(() => {
  jest.resetAllMocks();
  jest.mocked(usePrimaryGoalGate).mockReturnValue('ready');
});

describe('GoalLifecycleEntry', () => {
  it.each([
    'active',
    'paused',
  ] as const)('offers Cancel (only) for a %s goal that is not eligible', (status) => {
    renderEntry(makeGoal({ status }));
    expect(cancel()).toBeOnTheScreen();
    expect(screen.getByText('Cancel goal')).toBeOnTheScreen();
    expect(complete()).toBeNull();
  });

  it('offers nothing for a completed goal that is already settled', () => {
    renderEntry(makeGoal({ status: 'completed', current_amount: 0 }));
    expect(complete()).toBeNull();
    expect(cancel()).toBeNull();
  });

  it('offers Complete (only) for a completed goal', () => {
    renderEntry(makeGoal({ status: 'completed' }));
    expect(complete()).toBeOnTheScreen();
    expect(screen.getByText('Complete goal')).toBeOnTheScreen();
    expect(cancel()).toBeNull();
  });

  it('does not offer Complete when only credited interest reaches the target', () => {
    renderEntry(makeGoal({ current_amount: 5200, principal_amount: 4900 }));
    expect(cancel()).toBeOnTheScreen();
    expect(complete()).toBeNull();
  });

  it('offers both once the target is reached', () => {
    renderEntry(makeGoal({ current_amount: 5000 }));
    expect(cancel()).toBeOnTheScreen();
    expect(complete()).toBeOnTheScreen();
  });

  describe('maturity date', () => {
    beforeEach(() => {
      jest.useFakeTimers({ now: new Date('2026-11-05T15:00:00Z') });
    });
    afterEach(() => jest.useRealTimers());

    it.each([
      ['today', '2026-11-05', true],
      ['today with a time', '2026-11-05T23:00:00.000Z', true],
      ['the past', '2026-01-02', true],
      ['tomorrow', '2026-11-06', false],
      ['unreadable', 'soon', false],
    ])('maturity %s -> Complete shown: %s', (_name, maturity_date, shown) => {
      renderEntry(makeGoal({ maturity_date }));
      expect(complete() !== null).toBe(shown);
    });
  });

  describe('maturity compares the UTC date, whatever the device timezone', () => {
    beforeEach(() => {
      jest.useFakeTimers({ now: new Date('2026-11-06T01:00:00Z') });
      // Simulate a device in Los Angeles, where this instant is still 5 Nov:
      // local getters report the 5th while the UTC date is the 6th.
      jest.spyOn(Date.prototype, 'getFullYear').mockReturnValue(2026);
      jest.spyOn(Date.prototype, 'getMonth').mockReturnValue(10);
      jest.spyOn(Date.prototype, 'getDate').mockReturnValue(5);
    });
    afterEach(() => {
      jest.restoreAllMocks();
      jest.useRealTimers();
    });

    it('shows Complete for a goal maturing on the UTC today', () => {
      renderEntry(makeGoal({ maturity_date: '2026-11-06' }));
      expect(complete()).toBeOnTheScreen();
    });

    it('hides Complete for a goal maturing on the next UTC day', () => {
      renderEntry(makeGoal({ maturity_date: '2026-11-07' }));
      expect(complete()).toBeNull();
    });
  });

  it('passes the wallet refresh time to the readiness gate', () => {
    render(
      <GoalLifecycleEntry
        colors={Colors.light}
        goal={makeGoal()}
        hasPendingContribution={false}
        onCancel={mockOnCancel}
        onComplete={mockOnComplete}
        walletUpdatedAt={99}
      />
    );
    expect(usePrimaryGoalGate).toHaveBeenCalledWith(99, 0);
  });

  it('offers a retry when the readiness read fails, and re-reads on tap', () => {
    jest.mocked(usePrimaryGoalGate).mockReturnValue('error');
    renderEntry(makeGoal());
    expect(cancel()).toBeNull();
    fireEvent.press(
      screen.getByRole('button', { name: 'Try loading goal options again' })
    );
    expect(usePrimaryGoalGate).toHaveBeenLastCalledWith(undefined, 1);
  });

  // Walk 15: after the server came back the form recovered but this link
  // stayed until tapped; a quiet retry lets it heal on its own.
  it('re-reads a failed readiness verdict by itself after a pause', () => {
    jest.useFakeTimers();
    try {
      jest.mocked(usePrimaryGoalGate).mockReturnValue('error');
      renderEntry(makeGoal());
      expect(usePrimaryGoalGate).toHaveBeenLastCalledWith(undefined, 0);
      act(() => {
        jest.advanceTimersByTime(10_000);
      });
      expect(usePrimaryGoalGate).toHaveBeenLastCalledWith(undefined, 1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('opens the in-sheet Cancel and Complete steps, never another screen', () => {
    renderEntry(makeGoal({ current_amount: 5000 }));
    fireEvent.press(
      screen.getByRole('button', { name: 'Cancel savings goal' })
    );
    expect(mockOnCancel).toHaveBeenCalledTimes(1);
    expect(mockOnComplete).not.toHaveBeenCalled();
    fireEvent.press(
      screen.getByRole('button', { name: 'Complete savings goal' })
    );
    expect(mockOnComplete).toHaveBeenCalledTimes(1);
  });

  it.each([
    'checking',
    'off',
  ] as const)('renders nothing while the gate is %s', (gate) => {
    jest.mocked(usePrimaryGoalGate).mockReturnValue(gate);
    renderEntry(makeGoal({ current_amount: 5000 }));
    expect(cancel()).toBeNull();
    expect(complete()).toBeNull();
  });

  it('renders nothing while a contribution is pending', () => {
    renderEntry(makeGoal({ current_amount: 5000 }), true);
    expect(cancel()).toBeNull();
    expect(complete()).toBeNull();
  });

  it('renders Cancel as a quiet underlined link that still opens the cancel flow', () => {
    renderEntry(makeGoal({ status: 'active' }));
    const label = screen.getByText('Cancel goal');
    expect(StyleSheet.flatten(label.props.style)).toEqual(
      expect.objectContaining({ textDecorationLine: 'underline' })
    );
    expect(StyleSheet.flatten(cancel()?.props.style)).not.toHaveProperty(
      'borderWidth'
    );
    fireEvent.press(cancel() as never);
    expect(mockOnCancel).toHaveBeenCalledTimes(1);
  });

  it('keeps Complete as a regular button', () => {
    renderEntry(makeGoal({ status: 'completed' }));
    expect(StyleSheet.flatten(complete()?.props.style)).toHaveProperty(
      'borderWidth',
      1
    );
  });
});
