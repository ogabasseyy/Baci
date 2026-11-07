import { describe, expect, it } from 'vitest';
import { feedbackReportSchema } from './feedback-report';

describe('feedbackReportSchema', () => {
  it('accepts a full report and trims every field', () => {
    const result = feedbackReportSchema.parse({
      message: '  Orders tab is blank  ',
      screen: ' /orders ',
      appVersion: '2.1.530',
      platform: 'ios',
      device: 'iPhone 15 · iOS 26.1',
    });

    expect(result).toEqual({
      message: 'Orders tab is blank',
      screen: '/orders',
      appVersion: '2.1.530',
      platform: 'ios',
      device: 'iPhone 15 · iOS 26.1',
    });
  });

  it('accepts a message on its own', () => {
    expect(feedbackReportSchema.parse({ message: 'Hi' })).toEqual({
      message: 'Hi',
    });
  });

  it('drops optional labels that are blank after trimming', () => {
    const result = feedbackReportSchema.parse({ message: 'x', screen: '   ' });

    expect(result.screen).toBeUndefined();
  });

  it('rejects a whitespace-only message', () => {
    expect(feedbackReportSchema.safeParse({ message: '   ' }).success).toBe(
      false
    );
  });

  it('rejects a message over 4000 characters but allows exactly 4000', () => {
    expect(
      feedbackReportSchema.safeParse({ message: 'a'.repeat(4000) }).success
    ).toBe(true);
    expect(
      feedbackReportSchema.safeParse({ message: 'a'.repeat(4001) }).success
    ).toBe(false);
  });

  it('rejects an unknown platform', () => {
    expect(
      feedbackReportSchema.safeParse({ message: 'x', platform: 'windows' })
        .success
    ).toBe(false);
  });

  it('rejects an overlong screen label', () => {
    expect(
      feedbackReportSchema.safeParse({ message: 'x', screen: 's'.repeat(201) })
        .success
    ).toBe(false);
  });
});
