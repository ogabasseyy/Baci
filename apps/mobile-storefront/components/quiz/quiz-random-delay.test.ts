import { randomDelay } from './quiz-random-delay';

describe('randomDelay', () => {
  it('maps the random source onto 0..max inclusive', () => {
    expect(randomDelay(4_000, () => 0)).toBe(0);
    expect(randomDelay(4_000, () => 0.5)).toBe(2_000);
    expect(randomDelay(4_000, () => 0.999999)).toBe(4_000);
  });

  it('never exceeds the maximum when the random source returns 1', () => {
    expect(randomDelay(4_000, () => 1)).toBe(4_000);
    expect(randomDelay(0, () => 1)).toBe(0);
  });
});
