import { describe, expect, it } from 'vitest';
import {
  isDerivedKeyOf,
  isProof7KeyOf,
  isProof10KeyOf,
  proof7Key,
  proof7KeyPrefix,
  proof10Key,
} from './qa-keys';

const LONG_A = `${'q'.repeat(57)}AAAAAAA`;
const LONG_B = `${'q'.repeat(57)}BBBBBBB`;

describe('proof7Key', () => {
  it('is deterministic, bounded, and made only of journal-safe characters', () => {
    const key = proof7Key('qa-customer-0001', 2);
    expect(key).toBe(proof7Key('qa-customer-0001', 2));
    expect(key).toMatch(/^p7-[0-9a-f]{24}-a2$/);
    expect(proof7Key('q'.repeat(64), 99).length).toBeLessThanOrEqual(64);
  });

  it('differs per attempt', () => {
    expect(proof7Key('qa-customer-0001', 1)).not.toBe(
      proof7Key('qa-customer-0001', 2)
    );
  });

  it('keeps two QA keys that share their first 57 characters apart', () => {
    expect(LONG_A.slice(0, 57)).toBe(LONG_B.slice(0, 57));
    expect(proof7Key(LONG_A, 1)).not.toBe(proof7Key(LONG_B, 1));
    expect(proof7KeyPrefix(LONG_A)).not.toBe(proof7KeyPrefix(LONG_B));
  });

  it('does not embed the QA key itself', () => {
    expect(proof7Key('qa-customer-0001', 1)).not.toContain('qa-customer');
  });
});

describe('isProof7KeyOf', () => {
  it("matches only that QA key's own derived keys, at any attempt", () => {
    expect(
      isProof7KeyOf('qa-customer-0001', proof7Key('qa-customer-0001', 1))
    ).toBe(true);
    expect(
      isProof7KeyOf('qa-customer-0001', proof7Key('qa-customer-0001', 12))
    ).toBe(true);
    expect(
      isProof7KeyOf('qa-customer-0001', proof7Key('qa-customer-0002', 1))
    ).toBe(false);
    expect(isProof7KeyOf(LONG_A, proof7Key(LONG_B, 1))).toBe(false);
    expect(isProof7KeyOf(LONG_B, proof7Key(LONG_A, 1))).toBe(false);
  });

  it('rejects look-alikes: the plain key, a wrong suffix, extra characters', () => {
    const prefix = proof7KeyPrefix('qa-customer-0001');
    expect(isProof7KeyOf('qa-customer-0001', 'qa-customer-0001')).toBe(false);
    expect(isProof7KeyOf('qa-customer-0001', `${prefix}x`)).toBe(false);
    expect(isProof7KeyOf('qa-customer-0001', `${prefix}`)).toBe(false);
    expect(isProof7KeyOf('qa-customer-0001', `${prefix}123`)).toBe(false);
    expect(isProof7KeyOf('qa-customer-0001', `${prefix}1-extra`)).toBe(false);
  });
});

describe('proof10Key', () => {
  it('is bounded, per attempt, and distinct from the proof 7 key', () => {
    const key = proof10Key('qa-customer-0001', 2);
    expect(key).toMatch(/^p10-[0-9a-f]{24}-a2$/);
    expect(key).not.toBe(proof10Key('qa-customer-0001', 3));
    expect(key).not.toBe(proof7Key('qa-customer-0001', 2));
    expect(proof10Key('q'.repeat(64), 99).length).toBeLessThanOrEqual(64);
  });

  it('refuses to mint attempt 0, 100 or beyond, or a non-integer, instead of wrapping', () => {
    for (const attempt of [0, 100, 101, 1.5, Number.NaN]) {
      expect(() => proof10Key('qa-customer-0001', attempt)).toThrow(RangeError);
      expect(() => proof7Key('qa-customer-0001', attempt)).toThrow(RangeError);
    }
    // Every key it does mint is recognised by its own predicate.
    for (let attempt = 1; attempt <= 99; attempt += 1)
      expect(
        isProof10KeyOf(
          'qa-customer-0001',
          proof10Key('qa-customer-0001', attempt)
        )
      ).toBe(true);
  });

  it('is recognised only for its own QA key', () => {
    const key = proof10Key('qa-customer-0001', 1);
    expect(isProof10KeyOf('qa-customer-0001', key)).toBe(true);
    expect(isProof10KeyOf('qa-customer-0002', key)).toBe(false);
    expect(
      isProof10KeyOf('qa-customer-0001', proof7Key('qa-customer-0001', 1))
    ).toBe(false);
    expect(isDerivedKeyOf('qa-customer-0001', key)).toBe(true);
    expect(
      isDerivedKeyOf('qa-customer-0001', proof7Key('qa-customer-0001', 1))
    ).toBe(true);
    expect(isDerivedKeyOf('qa-customer-0001', 'qa-customer-0001')).toBe(false);
  });
});
