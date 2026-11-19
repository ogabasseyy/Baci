import {
  rememberGoalSetupPhase,
  resetGoalSetupMemory,
} from './goal-setup-memory';
import { shownGoalSetupPhase } from './shown-goal-setup-phase';

beforeEach(() => resetGoalSetupMemory());

describe('shownGoalSetupPhase with PiggyVest off', () => {
  it('shows a settled status as it is', () => {
    rememberGoalSetupPhase('a', 'ready');
    expect(shownGoalSetupPhase('pending', 'a')).toBe('pending');
    expect(shownGoalSetupPhase('error', 'a')).toBe('error');
  });

  it('shows the last ready or waiting status while a read is in flight', () => {
    rememberGoalSetupPhase('a', 'ready');
    expect(shownGoalSetupPhase('loading', 'a')).toBe('ready');
    rememberGoalSetupPhase('b', 'pending');
    expect(shownGoalSetupPhase('idle', 'b')).toBe('pending');
  });

  it('shows a stalled setup as still being set up, so nothing retries on stale news', () => {
    rememberGoalSetupPhase('a', 'setup_retryable');
    expect(shownGoalSetupPhase('loading', 'a')).toBe('pending');
  });

  it('keeps loading when nothing useful is known', () => {
    expect(shownGoalSetupPhase('loading', 'a')).toBe('loading');
    rememberGoalSetupPhase('b', 'not_started');
    expect(shownGoalSetupPhase('loading', 'b')).toBe('loading');
  });
});
