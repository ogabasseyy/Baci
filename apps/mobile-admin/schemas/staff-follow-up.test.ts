import { describe, expect, it } from 'vitest';
import { staffFollowUpSchema } from './staff-follow-up';

const record = {
  order_id: 'aa000000-0000-4000-8000-000000000021',
  merchant_id: 'aa000000-0000-4000-8000-000000000011',
  assignee_id: 'aa000000-0000-4000-8000-000000000001',
  assignee_name: 'Ada',
  stage: 'waiting',
  outcome: 'Asked customer to retry.',
  follow_up_on: '2026-11-20',
  revision: 1,
  updated_at: '2026-11-19T12:03:00+00:00',
};

describe('staff follow-up schema', () => {
  it('reads a follow-up with an assignee, outcome and due date', () => {
    expect(staffFollowUpSchema.parse(record)).toEqual(record);
  });

  it.each([
    '1900-01-01',
    '9999-12-31',
  ])('accepts the stored date boundary %s', (followUpOn) => {
    const row = { ...record, follow_up_on: followUpOn };
    expect(staffFollowUpSchema.parse(row)).toEqual(row);
  });

  it('accepts names and notes at the database character limit', () => {
    const row = {
      ...record,
      assignee_name: '🌱'.repeat(160),
      outcome: '🌱'.repeat(1000),
    };
    expect(staffFollowUpSchema.parse(row)).toEqual(row);
  });

  it('accepts an orphaned closed record with an empty outcome and no date', () => {
    const row = {
      ...record,
      assignee_id: null,
      assignee_name: 'A',
      stage: 'closed',
      outcome: '',
      follow_up_on: null,
      updated_at: '2026-11-19T12:03:00Z',
    };
    expect(staffFollowUpSchema.parse(row)).toEqual(row);
  });

  it.each([
    { order_id: 'bad-id' },
    { merchant_id: 'bad-id' },
    { assignee_id: '' },
    { assignee_name: '' },
    { assignee_name: '🌱'.repeat(161) },
    { outcome: '🌱'.repeat(1001) },
    { stage: 'paid' },
    { follow_up_on: '2026-02-30' },
    { follow_up_on: '1899-12-31' },
    { stage: 'closed' },
    { revision: 0 },
    { revision: -1 },
    { revision: 1.5 },
    { revision: '1' },
    { updated_at: '2026-11-19' },
    { updated_at: '2026-11-19T12:03:00' },
    { updated_at: '2026-02-30T12:03:00Z' },
  ])('rejects an invalid follow-up state %j', (change) => {
    expect(
      staffFollowUpSchema.safeParse({ ...record, ...change }).success
    ).toBe(false);
  });
});
