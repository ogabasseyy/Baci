// Server-off release-gate test: the automatic-check schedule is a pure
// function with no server or PiggyVest dependency.
import { describe, expect, it } from '@jest/globals';
import {
  AUTO_CHECK_LIMIT,
  autoCheckDelayMs,
} from './piggyvest-setup-auto-check';

describe('setup auto-check schedule', () => {
  it('checks quickly first, then every 15 seconds', () => {
    expect(autoCheckDelayMs(0)).toBe(3000);
    expect(autoCheckDelayMs(1)).toBe(5000);
    expect(autoCheckDelayMs(2)).toBe(8000);
    expect(autoCheckDelayMs(3)).toBe(15_000);
    expect(autoCheckDelayMs(AUTO_CHECK_LIMIT - 1)).toBe(15_000);
  });

  it('keeps checking for about five minutes, then stops', () => {
    let total = 0;
    for (let done = 0; done < AUTO_CHECK_LIMIT; done += 1) {
      total += autoCheckDelayMs(done) ?? 0;
    }
    expect(total).toBeGreaterThanOrEqual(5 * 60_000);
    expect(total).toBeLessThan(6 * 60_000);
    expect(autoCheckDelayMs(AUTO_CHECK_LIMIT)).toBeNull();
    expect(autoCheckDelayMs(-1)).toBeNull();
  });
});
