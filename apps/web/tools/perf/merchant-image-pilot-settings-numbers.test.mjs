import { describe, expect, it } from 'vitest';
import { parseNumberExpectation } from './merchant-image-pilot-settings-numbers.mjs';

describe('merchant-image-pilot-settings-numbers', () => {
  it('rejects non-positive numbers instead of passing geometry', () => {
    expect(parseNumberExpectation('2', 'expect-dpr')).toBe(2);
    expect(parseNumberExpectation('1.75', 'expect-dpr')).toBe(1.75);
    for (const bad of ['abc', '', '0', '-2', 'NaN', 'Infinity']) {
      expect(() => parseNumberExpectation(bad, 'expect-dpr')).toThrow(
        /bad --expect-dpr/
      );
    }
  });

  it('admits zero latencies when allowZero is enabled', () => {
    expect(
      parseNumberExpectation('0', 'expect-request-latency-ms', {
        allowZero: true,
      })
    ).toBe(0);
    expect(
      parseNumberExpectation('150', 'expect-rtt-ms', { allowZero: true })
    ).toBe(150);
    for (const bad of ['-1', 'abc', '', '   ', 'NaN', 'Infinity']) {
      expect(() =>
        parseNumberExpectation(bad, 'expect-rtt-ms', { allowZero: true })
      ).toThrow(/bad --expect-rtt-ms/);
    }
  });

  it('requires a positive integer when integer is enabled', () => {
    expect(
      parseNumberExpectation('2', 'expect-iterations', { integer: true })
    ).toBe(2);
    for (const bad of ['0', '-1', '1.5', 'abc', '', 'NaN']) {
      expect(() =>
        parseNumberExpectation(bad, 'expect-iterations', { integer: true })
      ).toThrow(/bad --expect-iterations/);
    }
  });
});
