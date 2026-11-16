import { beforeEach, describe, expect, it } from 'vitest';
import {
  hasRecentSessionCheck,
  RECENT_SESSION_CHECK_TTL_MS,
  recordSessionCheck,
  resetRecentSessionChecksForTesting,
} from './quiz-session-recency';

describe('quiz session recency', () => {
  beforeEach(() => resetRecentSessionChecksForTesting());

  it('does not know a token it has not been told about', () => {
    expect(hasRecentSessionCheck('token-a', 1_000)).toBe(false);
  });

  it('trusts a recorded check until the time limit, then forgets it', () => {
    recordSessionCheck('token-a', 1_000);

    expect(hasRecentSessionCheck('token-a', 1_000)).toBe(true);
    expect(
      hasRecentSessionCheck('token-a', 1_000 + RECENT_SESSION_CHECK_TTL_MS - 1)
    ).toBe(true);
    expect(
      hasRecentSessionCheck('token-a', 1_000 + RECENT_SESSION_CHECK_TTL_MS)
    ).toBe(false);
    // Forgotten for good, not just hidden for that one read.
    expect(hasRecentSessionCheck('token-a', 1_001)).toBe(false);
  });

  it('keeps tokens apart', () => {
    recordSessionCheck('token-a', 1_000);

    expect(hasRecentSessionCheck('token-b', 1_000)).toBe(false);
  });

  it('restarts the clock when a token is checked again', () => {
    recordSessionCheck('token-a', 1_000);
    recordSessionCheck('token-a', 50_000);

    expect(
      hasRecentSessionCheck('token-a', 50_000 + RECENT_SESSION_CHECK_TTL_MS - 1)
    ).toBe(true);
  });

  it('drops the oldest tokens instead of growing without bound', () => {
    recordSessionCheck('oldest', 1_000);
    for (let index = 0; index < 50_000; index += 1) {
      recordSessionCheck(`token-${index}`, 1_000);
    }

    expect(hasRecentSessionCheck('oldest', 1_000)).toBe(false);
    expect(hasRecentSessionCheck('token-49999', 1_000)).toBe(true);
  });
});
