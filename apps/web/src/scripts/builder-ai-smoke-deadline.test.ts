import { describe, expect, it, vi } from 'vitest';
import { settleBuilderAiSmokeBeforeDeadline } from './builder-ai-smoke-deadline';

describe('builder AI smoke deadline', () => {
  it('rejects a never-settling operation through its owned refed deadline', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const completion = settleBuilderAiSmokeBeforeDeadline(
      new Promise(() => {}),
      controller.signal,
      5_000
    );
    const expectation = expect(completion).rejects.toThrow(
      'Builder AI smoke deadline exceeded'
    );

    await vi.advanceTimersByTimeAsync(5_000);

    await expectation;
    vi.useRealTimers();
  });
});
