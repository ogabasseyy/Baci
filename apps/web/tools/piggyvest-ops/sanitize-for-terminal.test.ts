import { describe, expect, it } from 'vitest';
import { sanitizeForTerminal } from './sanitize-for-terminal';

describe('sanitizeForTerminal', () => {
  it('drops control, escape and bidi characters but keeps naira and dots', () => {
    expect(sanitizeForTerminal('A\u001b[31mred\u0007‮x ₦ ••••6789\n')).toBe(
      'A[31mredx ₦ ••••6789'
    );
  });
});
