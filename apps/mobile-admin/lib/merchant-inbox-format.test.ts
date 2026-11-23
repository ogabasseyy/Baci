import { describe, expect, it } from 'vitest';
import {
  followUpOptions,
  formatFollowUp,
  formatInboxTag,
  formatOrderCount,
} from './merchant-inbox-format';

describe('formatInboxTag', () => {
  it('turns a stored slug into a readable tag', () => {
    expect(formatInboxTag('order-issue')).toBe('Order issue');
    expect(formatInboxTag('lead')).toBe('Lead');
  });
});

describe('formatFollowUp', () => {
  const now = new Date('2026-11-22T10:00:00');

  it('says due when the time has come', () => {
    expect(formatFollowUp(null, true, now)).toBe('Follow up due');
  });

  it('names the day and time of a snoozed follow-up', () => {
    const label = formatFollowUp('2026-11-22T15:00:00', false, now);
    expect(label.startsWith('Follow up Today')).toBe(true);
  });

  it('falls back to a plain label for a missing or bad time', () => {
    expect(formatFollowUp(null, false, now)).toBe('Follow up');
    expect(formatFollowUp('nope', false, now)).toBe('Follow up');
  });
});

describe('followUpOptions', () => {
  it('offers only future times, soonest first', () => {
    const now = new Date('2026-11-22T10:00:00');
    const options = followUpOptions(now);
    expect(options.map((o) => o.label)).toEqual([
      'In 3 hours',
      'Tomorrow morning',
      'In 3 days',
      'Next week',
    ]);
    const times = options.map((o) => Date.parse(o.iso));
    expect(times.every((t) => t > now.getTime())).toBe(true);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });
});

describe('formatOrderCount', () => {
  it('says one order in the singular and anything else in the plural', () => {
    expect(formatOrderCount(1)).toBe('1 order');
    expect(formatOrderCount(5)).toBe('5 orders');
    expect(formatOrderCount(0)).toBe('0 orders');
  });
});
