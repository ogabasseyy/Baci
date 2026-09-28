import { describe, expect, it } from 'vitest';
import { cancellationDrainDeadlineMs } from './cancellation-drain-deadline';

describe('cancellationDrainDeadlineMs', () => {
  it('sets the absolute deadline at the budget minus the safety margin', () => {
    expect(cancellationDrainDeadlineMs(1_000_000)).toBe(1_270_000);
  });
});
