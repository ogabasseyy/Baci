import { describe, expect, it, vi } from 'vitest';
import {
  readNotificationType,
  recordPushAttemptWithStore,
} from './expo-push-attempts';
import type { PushStore } from './push-store';

function store(insertAttempt: PushStore['insertAttempt']): PushStore {
  return { insertAttempt } as PushStore;
}

const context = {
  body: 'b',
  result: { errors: [], failed: 0, sent: 1, succeededTokens: ['t'] },
  title: 't',
  tokenCount: 1,
};

describe('readNotificationType', () => {
  it('reads a string type and ignores anything else', () => {
    expect(readNotificationType({ type: 'x' })).toBe('x');
    expect(readNotificationType({ type: 1 })).toBeUndefined();
  });
});

describe('recordPushAttemptWithStore', () => {
  it('stores a sent attempt with the delivered tokens', async () => {
    const insertAttempt = vi.fn().mockResolvedValue({ error: null });

    await recordPushAttemptWithStore(store(insertAttempt), {
      ...context,
      merchantId: 'm',
    });

    expect(insertAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        merchant_id: 'm',
        sent_count: 1,
        status: 'sent',
      })
    );
  });

  it('retries a failed write and still resolves when it keeps failing', async () => {
    vi.useFakeTimers();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const insertAttempt = vi
      .fn()
      .mockResolvedValue({ error: { message: 'down' } });

    const done = recordPushAttemptWithStore(store(insertAttempt), context);
    await vi.runAllTimersAsync();
    await done;

    expect(insertAttempt).toHaveBeenCalledTimes(3);
    error.mockRestore();
    vi.useRealTimers();
  });
});
