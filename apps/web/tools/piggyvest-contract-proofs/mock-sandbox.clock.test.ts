import { describe, expect, it } from 'vitest';
import { MockSandbox } from './mock-sandbox';

const tick = (sandbox: MockSandbox, times: number): string => {
  let last = '';
  for (let i = 0; i < times; i += 1) last = sandbox.now();
  return last;
};

describe('MockSandbox clock', () => {
  it('starts one second after the base time and counts in seconds', () => {
    const sandbox = new MockSandbox();
    expect(sandbox.now()).toBe('2026-10-30T10:00:01.000Z');
    expect(sandbox.now()).toBe('2026-10-30T10:00:02.000Z');
  });

  it('rolls over to the next hour instead of producing minute 60', () => {
    expect(tick(new MockSandbox(), 59)).toBe('2026-10-30T10:00:59.000Z');
    expect(tick(new MockSandbox(), 3599)).toBe('2026-10-30T10:59:59.000Z');
    expect(tick(new MockSandbox(), 3600)).toBe('2026-10-30T11:00:00.000Z');
  });

  it('rolls over to the next day at 86400 ticks', () => {
    expect(tick(new MockSandbox(), 86_400)).toBe('2026-10-31T10:00:00.000Z');
  });

  it('only ever produces valid ISO timestamps, in increasing order', () => {
    const sandbox = new MockSandbox();
    let previous = 0;
    for (let i = 0; i < 4000; i += 1) {
      const stamp = sandbox.now();
      const parsed = Date.parse(stamp);
      expect(Number.isNaN(parsed)).toBe(false);
      expect(new Date(parsed).toISOString()).toBe(stamp);
      expect(parsed).toBeGreaterThan(previous);
      previous = parsed;
    }
  });
});
