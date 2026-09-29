import { describe, expect, it } from 'vitest';
import { cancellationSideEffectDrainLimit } from './cancellation-side-effect-drain-limit';

describe('cancellationSideEffectDrainLimit', () => {
  it('reserves a notification share behind the side-effect batch', () => {
    // 90s after the margin, the 150s notification reserve, and the 30s
    // handoff slack fits three 30s worst-case steps; a full 60s
    // reconcile phase leaves one.
    expect(cancellationSideEffectDrainLimit(0)).toBe(3);
    expect(cancellationSideEffectDrainLimit(60_000)).toBe(1);
  });

  it('shrinks the batch as the invocation budget burns down', () => {
    // 80s of worker time leaves 10s after the margin, reserve, and
    // slack: no step fits, so the drain yields to the notification share.
    expect(cancellationSideEffectDrainLimit(50_000)).toBe(1);
    expect(cancellationSideEffectDrainLimit(80_000)).toBe(0);
  });

  it('skips the drain when no step fits safely', () => {
    expect(cancellationSideEffectDrainLimit(270_000)).toBe(0);
    expect(cancellationSideEffectDrainLimit(400_000)).toBe(0);
  });
});
