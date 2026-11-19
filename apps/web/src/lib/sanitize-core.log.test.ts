import { describe, expect, it } from 'vitest';
import { sanitizeForLog } from '@/lib/sanitize-core';

describe('sanitizeForLog Error formatting', () => {
  it('formats Error instances cleanly instead of returning "{}"', () => {
    const err = new Error('Something went wrong\nwith details');
    const result = sanitizeForLog(err);
    expect(result).not.toBe('{}');
    expect(result).toContain('Error: Something went wrong');
    expect(result).not.toContain('\n');

    const emptyErr = new TypeError('');
    expect(sanitizeForLog(emptyErr)).toBe('TypeError');
  });
});
