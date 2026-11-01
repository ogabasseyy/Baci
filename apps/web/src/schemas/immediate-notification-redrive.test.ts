import { describe, expect, it } from 'vitest';
import {
  immediateNotificationRecoveryBatchQuery,
  immediateNotificationRecoveryBatchSize,
  immediateNotificationRecoveryCandidates,
} from './immediate-notification-redrive';

describe('immediate notification recovery validation', () => {
  it.each([1, 100])('accepts boundary batch size %i', (value) => {
    expect(immediateNotificationRecoveryBatchSize.parse(value)).toBe(value);
  });
  it.each([
    0,
    101,
    1.5,
    Number.NaN,
  ])('rejects invalid batch size %s', (value) => {
    expect(
      immediateNotificationRecoveryBatchSize.safeParse(value).success
    ).toBe(false);
  });
  it.each(['1', '100'])('converts a bounded query value %s', (value) => {
    expect(immediateNotificationRecoveryBatchQuery.parse(value)).toBe(
      Number(value)
    );
  });
  it.each([
    '',
    '0',
    '101',
    '01',
    '-1',
    '1.5',
    ' 1 ',
    '1e1',
  ])('rejects query value %s', (value) => {
    expect(
      immediateNotificationRecoveryBatchQuery.safeParse(value).success
    ).toBe(false);
  });
  it('validates bounded recovery rows and their statuses', () => {
    const valid = {
      order_id: 'd0000000-0000-4000-8000-000000000001',
      claim_token: 'd0000000-0000-4000-8000-000000000002',
      status: 'accepted',
    };
    expect(
      immediateNotificationRecoveryCandidates.safeParse([valid]).success
    ).toBe(true);
    expect(
      immediateNotificationRecoveryCandidates.safeParse([
        { ...valid, order_id: 'invalid' },
      ]).success
    ).toBe(false);
    expect(
      immediateNotificationRecoveryCandidates.safeParse([
        { ...valid, status: 'sent' },
      ]).success
    ).toBe(false);
    expect(
      immediateNotificationRecoveryCandidates.safeParse(Array(101).fill(valid))
        .success
    ).toBe(false);
  });
});
