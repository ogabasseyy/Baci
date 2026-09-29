import { describe, expect, it } from 'vitest';
import { cancellationSideEffectDrainLimit } from './cancellation-side-effect-drain-limit';

describe('cancellationSideEffectDrainLimit', () => {
  it('drains the worst-case batch when the workers were fast', () => {
    // 270s after the margin fits nine 30s worst-case steps.
    expect(cancellationSideEffectDrainLimit(0)).toBe(9);
    expect(cancellationSideEffectDrainLimit(60_000)).toBe(7);
  });

  it('shrinks the batch as the invocation budget burns down', () => {
    // 200s of worker time leaves 70s after the margin: 2 steps fit.
    expect(cancellationSideEffectDrainLimit(200_000)).toBe(2);
  });

  it('skips the drain when no step fits safely', () => {
    expect(cancellationSideEffectDrainLimit(270_000)).toBe(0);
    expect(cancellationSideEffectDrainLimit(400_000)).toBe(0);
  });
});
