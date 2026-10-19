import { describe, expect, it } from 'vitest';
import { buildAdminBusinessTypeBreakdowns } from '@/lib/admin-business-type-breakdowns';

describe('buildAdminBusinessTypeBreakdowns', () => {
  it('maps aggregated database counts without expanding merchant rows', () => {
    expect(
      buildAdminBusinessTypeBreakdowns(
        [
          { businessType: 'fashion', merchants: 12 },
          { businessType: ' Fashion ', merchants: 3 },
          { businessType: 'Church', merchants: 2 },
          { businessType: null, merchants: 8 },
        ],
        25
      )
    ).toEqual([
      {
        businessType: 'fashion',
        classification: 'configured',
        label: 'Fashion & Apparel',
        merchants: 15,
        rawValues: [],
        shareOfMerchants: 60,
      },
      {
        businessType: 'unspecified',
        classification: 'unspecified',
        label: 'Unspecified',
        merchants: 8,
        rawValues: [],
        shareOfMerchants: 32,
      },
      {
        businessType: 'invalid',
        classification: 'invalid',
        label: 'Invalid / Legacy Values',
        merchants: 2,
        rawValues: ['Church'],
        shareOfMerchants: 8,
      },
    ]);
  });

  it('handles an empty platform safely', () => {
    expect(buildAdminBusinessTypeBreakdowns([], 0)).toEqual([]);
  });
});
