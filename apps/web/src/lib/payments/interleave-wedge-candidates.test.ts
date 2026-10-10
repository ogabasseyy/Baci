import { describe, expect, it } from 'vitest';
import { interleaveWedgeCandidates } from './interleave-wedge-candidates';

describe('interleaveWedgeCandidates', () => {
  it('interleaves mains first in round-robin order', () => {
    expect(interleaveWedgeCandidates(['m1', 'm2', 'm3'], ['r1', 'r2'])).toEqual(
      ['m1', 'r1', 'm2', 'r2', 'm3']
    );
  });

  it('passes retries through when no mains remain', () => {
    expect(interleaveWedgeCandidates([], ['r1', 'r2'])).toEqual(['r1', 'r2']);
  });

  it('passes mains through when no retries exist', () => {
    expect(interleaveWedgeCandidates(['m1'], [])).toEqual(['m1']);
  });

  it('returns empty for empty inputs', () => {
    expect(interleaveWedgeCandidates([], [])).toEqual([]);
  });
});
