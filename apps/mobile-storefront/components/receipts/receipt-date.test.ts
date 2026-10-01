import { formatReceiptDate } from './receipt-date';

describe('formatReceiptDate', () => {
  it('preserves date-only invoice issue dates west of UTC', () => {
    expect(formatReceiptDate('2026-07-16')).toBe('16 Jul 2026');
  });

  it('renders timestamps in Africa/Lagos calendar semantics', () => {
    expect(formatReceiptDate('2026-07-16T00:30:00.000Z')).toBe('16 Jul 2026');
  });

  it('rolls timestamps past the Lagos midnight boundary to the next day', () => {
    // 23:30 UTC is 00:30 the next day in Lagos (UTC+1).
    expect(formatReceiptDate('2026-07-15T23:30:00.000Z')).toBe('16 Jul 2026');
  });
});
