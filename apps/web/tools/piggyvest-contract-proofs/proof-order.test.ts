import { describe, expect, it } from 'vitest';
import { FULL_RUN_ONLY_PROOFS, PROOF_IDS } from './constants';
import { PROOF_ORDER } from './proof-order';

describe('PROOF_ORDER', () => {
  it('lists each proof exactly once, with a title', () => {
    const ids = PROOF_ORDER.map(([id]) => id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const [, run, title] of PROOF_ORDER) {
      expect(typeof run).toBe('function');
      expect(title.length).toBeGreaterThan(0);
    }
  });

  it('covers every base proof id and runs proof 3 before proofs 8 and 9', () => {
    const ids: string[] = PROOF_ORDER.map(([id]) => id);
    for (const id of PROOF_IDS) expect(ids).toContain(id);
    expect(ids.indexOf('p3')).toBeLessThan(ids.indexOf('p8'));
    expect(ids.indexOf('p3')).toBeLessThan(ids.indexOf('p9'));
  });

  it('names every proof it runs in PROOF_IDS, and refuses p8 and p9 alone', () => {
    const ids: string[] = PROOF_ORDER.map(([id]) => id);
    expect([...PROOF_IDS].sort()).toEqual([...ids].sort());
    expect(PROOF_IDS).toContain('p8');
    expect(PROOF_IDS).toContain('p9');
    expect(FULL_RUN_ONLY_PROOFS).toEqual(expect.arrayContaining(['p8', 'p9']));
  });
});
