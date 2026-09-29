import { describe, expect, it } from 'vitest';
import { cancellationSideEffectDrainLimit } from './cancellation-side-effect-drain-limit';

describe('cancellationSideEffectDrainLimit', () => {
  it('reserves a notification share behind the side-effect batch', () => {
    // 120s after the margin and the 150s notification reserve fits four
    // 30s worst-case steps; a full 60s reconcile phase leaves two.
    expect(cancellationSideEffectDrainLimit(0)).toBe(4);
    expect(cancellationSideEffectDrainLimit(60_000)).toBe(2);
  });

  it('shrinks the batch as the invocation budget burns down', () => {
    // 100s of worker time leaves 20s after the margin and reserve: no
    // step fits, so the drain yields to the notification share.
    expect(cancellationSideEffectDrainLimit(80_000)).toBe(1);
    expect(cancellationSideEffectDrainLimit(100_000)).toBe(0);
  });

  it('skips the drain when no step fits safely', () => {
    expect(cancellationSideEffectDrainLimit(270_000)).toBe(0);
    expect(cancellationSideEffectDrainLimit(400_000)).toBe(0);
  });
});
