import { describe, expect, it } from 'vitest';
import { formatAdminAuditDate } from './admin-audit-format';

describe('formatAdminAuditDate', () => {
  it('formats an offset audit timestamp for Nigerian operators', () => {
    const value = '2026-08-05T14:30:00+01:00';
    const expected = new Intl.DateTimeFormat('en-NG', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(value));

    expect(formatAdminAuditDate(value)).toBe(expected);
  });

  it('rejects an invalid audit timestamp instead of formatting a misleading value', () => {
    expect(() => formatAdminAuditDate('not-a-timestamp')).toThrow(RangeError);
  });
});
