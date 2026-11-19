import { describe, expect, it } from 'vitest';
import { compareFollowUpDatesDesc } from './compare-follow-up-dates-desc';

describe('compareFollowUpDatesDesc', () => {
  it('orders valid timestamps by their instant across offsets', () => {
    expect(
      ['2026-11-17T10:00:00+02:00', '2026-11-17T09:00:00Z'].sort(
        compareFollowUpDatesDesc
      )
    ).toEqual(['2026-11-17T09:00:00Z', '2026-11-17T10:00:00+02:00']);
  });
  it('moves invalid dates last and retains their original order', () => {
    expect(
      ['invalid-first', '2026-11-17T09:00:00Z', 'invalid-second'].sort(
        compareFollowUpDatesDesc
      )
    ).toEqual(['2026-11-17T09:00:00Z', 'invalid-first', 'invalid-second']);
  });
  it('returns equality for equivalent dates and invalid pairs', () => {
    expect(
      compareFollowUpDatesDesc(
        '2026-11-17T10:00:00+01:00',
        '2026-11-17T09:00:00Z'
      )
    ).toBe(0);
    expect(compareFollowUpDatesDesc('', 'invalid')).toBe(0);
  });
});
