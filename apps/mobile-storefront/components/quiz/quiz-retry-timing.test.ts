import { backoffDelay, randomDelay, withSpread } from './quiz-retry-timing';

describe('withSpread', () => {
  it('returns the base value when the random source is centred', () => {
    expect(withSpread(10_000, () => 0.5)).toBe(10_000);
  });

  it('spans plus/minus 20% across the random range', () => {
    expect(withSpread(10_000, () => 0)).toBe(8_000);
    expect(withSpread(10_000, () => 1)).toBe(12_000);
  });

  it('stays within bounds for many Math.random draws', () => {
    for (let i = 0; i < 200; i += 1) {
      const value = withSpread(10_000);
      expect(value).toBeGreaterThanOrEqual(8_000);
      expect(value).toBeLessThanOrEqual(12_000);
    }
  });
});

describe('backoffDelay', () => {
  const input = { baseMs: 10_000, capMs: 60_000, random: () => 0.5 };

  it('uses the base interval when nothing has failed', () => {
    expect(backoffDelay({ ...input, failures: 0 })).toBe(10_000);
  });

  it('doubles per consecutive failure', () => {
    expect(backoffDelay({ ...input, failures: 1 })).toBe(10_000);
    expect(backoffDelay({ ...input, failures: 2 })).toBe(20_000);
    expect(backoffDelay({ ...input, failures: 3 })).toBe(40_000);
  });

  it('caps the unspread delay and never exceeds cap plus spread', () => {
    expect(backoffDelay({ ...input, failures: 4 })).toBe(60_000);
    expect(backoffDelay({ ...input, failures: 50 })).toBe(60_000);
    expect(backoffDelay({ ...input, failures: 50, random: () => 1 })).toBe(
      72_000
    );
  });

  it('applies spread bounds to the backed-off value', () => {
    expect(backoffDelay({ ...input, failures: 2, random: () => 0 })).toBe(
      16_000
    );
    expect(backoffDelay({ ...input, failures: 2, random: () => 1 })).toBe(
      24_000
    );
  });

  it('never returns less than the floor', () => {
    expect(
      backoffDelay({ ...input, failures: 1, random: () => 0, floorMs: 15_000 })
    ).toBe(15_000);
    expect(backoffDelay({ ...input, failures: 3, floorMs: 15_000 })).toBe(
      40_000
    );
  });
});

describe('randomDelay', () => {
  it('maps the random source onto 0..max inclusive', () => {
    expect(randomDelay(4_000, () => 0)).toBe(0);
    expect(randomDelay(4_000, () => 0.5)).toBe(2_000);
    expect(randomDelay(4_000, () => 0.999999)).toBe(4_000);
  });
});
