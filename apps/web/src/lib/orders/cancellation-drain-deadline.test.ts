import { describe, expect, it } from 'vitest';
import { cancellationDrainDeadlineMs } from './cancellation-drain-deadline';

describe('cancellationDrainDeadlineMs', () => {
  it('ends side-effect work before the safety margin and notification reserve', () => {
    expect(cancellationDrainDeadlineMs(1_000_000)).toBe(1_120_000);
  });
});
