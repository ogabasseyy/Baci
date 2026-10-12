import { describe, expect, it } from 'vitest';
import { piggyvestPolicyTextByteLength } from './piggyvest-policy-text-byte-length';

describe('portable policy UTF-8 length', () => {
  it.each([
    ['', 0],
    ['abc', 3],
    ['é', 2],
    ['中', 3],
    ['😀', 4],
    ['aé中😀', 10],
    ['\ud800', Number.POSITIVE_INFINITY],
    ['\udc00', Number.POSITIVE_INFINITY],
    ['\ud800a', Number.POSITIVE_INFINITY],
  ])('measures or rejects %j', (value, expected) => {
    expect(piggyvestPolicyTextByteLength(value)).toBe(expected);
  });
});
