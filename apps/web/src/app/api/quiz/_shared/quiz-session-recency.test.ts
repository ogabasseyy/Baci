import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { logger } from '@/lib/logger';
import { getRedis } from '@/lib/redis';
import {
  hasRecentSessionCheck,
  RECENT_SESSION_CHECK_TTL_MS,
  recordSessionCheck,
  rememberSessionCheck,
  resetRecentSessionChecksForTesting,
  wasSessionCheckedRecently,
} from './quiz-session-recency';

vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn() } }));
vi.mock('@/lib/redis', () => ({ getRedis: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getRedis).mockReturnValue(null);
  resetRecentSessionChecksForTesting();
});

describe('quiz session recency', () => {
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

describe('quiz session recency shared store', () => {
  const TTL = RECENT_SESSION_CHECK_TTL_MS;

  function useSharedStore() {
    const values = new Map<string, unknown>();
    const store = {
      get: vi.fn(async (key: string): Promise<unknown> => {
        return values.get(key) ?? null;
      }),
      set: vi.fn(async (key: string, value: unknown, _options?: unknown) => {
        values.set(key, value);
        return 'OK';
      }),
    };
    vi.mocked(getRedis).mockReturnValue(store as never);
    return store;
  }
  // A different server instance has its own, empty memory.
  const switchToAnotherInstance = () => resetRecentSessionChecksForTesting();

  afterEach(() => vi.useRealTimers());

  it('works from memory alone when no store is configured', async () => {
    await rememberSessionCheck('token-a', 1_000);

    expect(await wasSessionCheckedRecently('token-a', 1_000)).toBe(true);
    expect(await wasSessionCheckedRecently('token-b', 1_000)).toBe(false);
  });

  it('counts a check made on another server instance', async () => {
    const store = useSharedStore();
    await rememberSessionCheck('token-a', 1_000);
    switchToAnotherInstance();

    expect(await wasSessionCheckedRecently('token-a', 2_000)).toBe(true);
    // Now in this instance's memory: the store is not read a second time.
    expect(await wasSessionCheckedRecently('token-a', 3_000)).toBe(true);
    expect(store.get).toHaveBeenCalledTimes(1);
  });

  it('stores a hash with the time limit, never the token', async () => {
    const store = useSharedStore();
    await rememberSessionCheck('secret-token', 1_000);

    expect(store.set).toHaveBeenCalledWith(
      expect.stringMatching(/^quiz:session-check:v1:[0-9a-f]{64}$/),
      1_000,
      { px: TTL }
    );
    expect(JSON.stringify(store.set.mock.calls)).not.toContain('secret-token');
  });

  it('keeps the original check time, so the limit is not stretched', async () => {
    useSharedStore();
    await rememberSessionCheck('token-a', 1_000);
    switchToAnotherInstance();

    expect(await wasSessionCheckedRecently('token-a', 1_000 + TTL - 1)).toBe(
      true
    );
    // Memory took the time of the original check, not of this read.
    expect(hasRecentSessionCheck('token-a', 1_000 + TTL)).toBe(false);
    // A stored check that is too old is ignored even if the store kept it.
    expect(await wasSessionCheckedRecently('token-a', 1_000 + TTL)).toBe(false);
  });

  it('tolerates a small clock difference but not a time far ahead', async () => {
    useSharedStore();
    await rememberSessionCheck('token-near', 3_000);
    await rememberSessionCheck('token-far', 100_000);
    switchToAnotherInstance();

    expect(await wasSessionCheckedRecently('token-near', 1_000)).toBe(true);
    expect(await wasSessionCheckedRecently('token-far', 1_000)).toBe(false);
  });

  it('ignores a stored value that is not a time', async () => {
    const store = useSharedStore();
    store.get.mockResolvedValueOnce('yes');

    expect(await wasSessionCheckedRecently('token-a', 1_000)).toBe(false);
  });

  it('asks again when the store fails, warning once', async () => {
    const store = useSharedStore();
    store.get.mockRejectedValue(new Error('store down'));

    expect(await wasSessionCheckedRecently('token-a', 1_000)).toBe(false);
    expect(await wasSessionCheckedRecently('token-a', 2_000)).toBe(false);
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it('does not wait for a slow store', async () => {
    vi.useFakeTimers();
    const store = useSharedStore();
    store.get.mockReturnValue(new Promise<never>(() => undefined));

    const answer = wasSessionCheckedRecently('token-a', 1_000);
    await vi.advanceTimersByTimeAsync(150);

    expect(await answer).toBe(false);
  });

  it('still remembers locally when the store cannot be written', async () => {
    const store = useSharedStore();
    store.set.mockRejectedValueOnce(new Error('store down'));

    await rememberSessionCheck('token-a', 1_000);

    expect(hasRecentSessionCheck('token-a', 1_000)).toBe(true);
  });
});
