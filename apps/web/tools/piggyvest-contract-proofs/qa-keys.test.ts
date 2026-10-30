import { describe, expect, it } from 'vitest';
import { isProof7KeyOf, proof7Key, proof7KeyPrefix } from './qa-keys';

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
