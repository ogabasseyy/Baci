import {
  goalSetupFirstWaitingAt,
  goalSetupStartedLater,
  lastGoalSetupPhase,
  rememberGoalSetupPhase,
  resetGoalSetupMemory,
} from './goal-setup-memory';

beforeEach(() => resetGoalSetupMemory());

describe('goal setup memory with PiggyVest off', () => {
  it('remembers when the setup was first seen waiting, across later reads', () => {
    rememberGoalSetupPhase('a', 'pending', 1000);
    rememberGoalSetupPhase('a', 'setup_retryable', 9000);
    rememberGoalSetupPhase('a', 'pending', 20_000);
    expect(goalSetupFirstWaitingAt('a')).toBe(1000);
    expect(lastGoalSetupPhase('a')).toBe('pending');
  });

  it('forgets the waiting time once the plan is ready', () => {
    rememberGoalSetupPhase('a', 'pending', 1000);
    rememberGoalSetupPhase('a', 'ready', 2000);
    expect(goalSetupFirstWaitingAt('a')).toBeNull();
    expect(lastGoalSetupPhase('a')).toBe('ready');
  });

  it('ignores reads that have not settled', () => {
    rememberGoalSetupPhase('a', 'pending', 1000);
    rememberGoalSetupPhase('a', 'loading', 2000);
    rememberGoalSetupPhase('a', 'error', 3000);
    rememberGoalSetupPhase('a', 'idle', 4000);
    expect(lastGoalSetupPhase('a')).toBe('pending');
  });

  it('keeps each account, merchant and goal apart', () => {
    rememberGoalSetupPhase('a', 'ready');
    expect(lastGoalSetupPhase('b')).toBeNull();
    expect(goalSetupFirstWaitingAt('b')).toBeNull();
  });
});

describe('bugfix: the per-goal memory grew without limit', () => {
  it('forgets the oldest goal after 64', () => {
    for (let n = 0; n <= 64; n += 1) rememberGoalSetupPhase(`g${n}`, 'ready');
    expect(lastGoalSetupPhase('g0')).toBeNull();
    expect(lastGoalSetupPhase('g64')).toBe('ready');
  });
});

describe('setup started after the plan was made', () => {
  it('is marked when the goal was seen not started, then waiting', () => {
    rememberGoalSetupPhase('a', 'not_started');
    rememberGoalSetupPhase('a', 'pending');
    expect(goalSetupStartedLater('a')).toBe(true);
  });

  it('is not marked for a setup first seen already waiting', () => {
    rememberGoalSetupPhase('b', 'pending');
    expect(goalSetupStartedLater('b')).toBe(false);
  });
});
