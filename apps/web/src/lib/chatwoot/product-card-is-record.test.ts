import { describe, expect, it } from 'vitest';
import { isRecord } from './product-card-is-record';

describe('isRecord', () => {
  it('recognises plain records only', () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord([])).toBe(false);
    expect(isRecord(null)).toBe(false);
    expect(isRecord('x')).toBe(false);
  });
});
