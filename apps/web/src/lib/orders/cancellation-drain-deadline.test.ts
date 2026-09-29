import { describe, expect, it } from 'vitest';
import { cancellationDrainDeadlineMs } from './cancellation-drain-deadline';

describe('cancellationDrainDeadlineMs', () => {
  it('ends side-effect work before the safety margin and notification reserve', () => {
    // 300s budget minus the 30s margin, the 150s notification reserve,
    // and the 30s handoff slack: the final step's tail must land before
    // the notification threshold, not on it.
    expect(cancellationDrainDeadlineMs(1_000_000)).toBe(1_090_000);
  });
});
