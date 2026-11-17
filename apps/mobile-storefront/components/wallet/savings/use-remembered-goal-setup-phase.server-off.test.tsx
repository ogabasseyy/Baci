import { act, renderHook } from '@testing-library/react-native';
import {
  rememberGoalSetupPhase,
  resetGoalSetupMemory,
} from './goal-setup-memory';
import { useRememberedGoalSetupPhase } from './use-remembered-goal-setup-phase';

beforeEach(() => resetGoalSetupMemory());

describe('useRememberedGoalSetupPhase with PiggyVest off', () => {
  it('is null until a status is learned, then follows each change', () => {
    const { result } = renderHook(() => useRememberedGoalSetupPhase('a'));
    expect(result.current).toBeNull();
    act(() => rememberGoalSetupPhase('a', 'pending'));
    expect(result.current).toBe('pending');
    act(() => rememberGoalSetupPhase('a', 'ready'));
    expect(result.current).toBe('ready');
  });

  it('ignores other goals', () => {
    const { result } = renderHook(() => useRememberedGoalSetupPhase('a'));
    act(() => rememberGoalSetupPhase('b', 'ready'));
    expect(result.current).toBeNull();
  });
});
