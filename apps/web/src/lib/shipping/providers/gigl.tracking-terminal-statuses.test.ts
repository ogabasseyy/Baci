import { describe, expect, it } from 'vitest';
import { TERMINAL_STATUSES } from './gigl.tracking-terminal-statuses';

describe('TERMINAL_STATUSES', () => {
  it('contains the canonical terminal tracking statuses', () => {
    expect(TERMINAL_STATUSES.has('delivered')).toBe(true);
    expect(TERMINAL_STATUSES.has('returned')).toBe(true);
    expect(TERMINAL_STATUSES.has('cancelled')).toBe(true);
    expect(TERMINAL_STATUSES.has('in_transit')).toBe(false);
    expect(TERMINAL_STATUSES.size).toBe(3);
  });
});
