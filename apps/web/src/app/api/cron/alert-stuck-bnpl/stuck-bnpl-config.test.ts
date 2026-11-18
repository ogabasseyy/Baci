import { describe, expect, it } from 'vitest';
import { STUCK_BNPL_CONFIG } from './stuck-bnpl-config';

describe('STUCK_BNPL_CONFIG', () => {
  it('bounds the recovery scan and covers every supported BNPL pending state', () => {
    expect(STUCK_BNPL_CONFIG).toEqual({
      maxAgeDays: 7,
      minAgeHours: 24,
      notificationConcurrency: 5,
      orderScanLimit: 500,
      transactionLookupBatchSize: 50,
      transactionLookupPageSize: 200,
      paymentMethods: ['credit_direct', 'klump', 'credpal'],
      paymentStatuses: ['bnpl_pending', 'bnpl_approved', 'pending', 'unpaid'],
    });
  });
});
