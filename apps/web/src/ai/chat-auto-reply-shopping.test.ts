import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  LOOKUP_DEADLINE_MS,
  withLookupDeadline,
} from './chat-auto-reply-shopping';

describe('chat-auto-reply-shopping', () => {
  it('resolves values before the lookup deadline', async () => {
    expect(LOOKUP_DEADLINE_MS).toBe(10_000);
    await expect(withLookupDeadline(Promise.resolve('ok'), 100)).resolves.toBe(
      'ok'
    );
  });

  it('rejects when the lookup exceeds its deadline', async () => {
    vi.useFakeTimers();
    try {
      const pending = new Promise<string>(() => undefined);
      const result = withLookupDeadline(pending, 50);
      const assertion = expect(result).rejects.toThrow('Lookup timed out');
      await vi.advanceTimersByTimeAsync(50);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });
});
