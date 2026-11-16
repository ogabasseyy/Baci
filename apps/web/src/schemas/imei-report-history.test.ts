import { describe, expect, it } from 'vitest';
import { imeiReportHistoryQuerySchema } from './imei-report-history';

describe('IMEI report history query', () => {
  it('defaults pagination and accepts a valid merchant', () => {
    expect(
      imeiReportHistoryQuerySchema.parse({ merchantSlug: 'ogabassey' })
    ).toEqual({ page: 0, merchantSlug: 'ogabassey' });
  });
  it.each(['-1', '1.2', '100001', 'abc'])('rejects invalid page %s', (page) => {
    expect(imeiReportHistoryQuerySchema.safeParse({ page }).success).toBe(
      false
    );
  });
  it('rejects malformed merchant slugs', () => {
    expect(
      imeiReportHistoryQuerySchema.safeParse({ merchantSlug: '../other' })
        .success
    ).toBe(false);
  });
});
