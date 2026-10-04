import { describe, expect, it } from 'vitest';
import { prefundedCardKnownDeadlineSchema } from './prefunded-card-known-deadline';

describe('prefunded card known lease deadlines', () => {
  it.each([
    '2026-09-29T15:59:10Z',
    '2026-10-06T15:59:10Z',
  ])('accepts the approved exact deadline %s', (expiresAt) => {
    expect(prefundedCardKnownDeadlineSchema.parse(expiresAt)).toBe(expiresAt);
  });

  it.each([
    '2026-10-06T15:59:11Z',
    '2026-10-07T00:00:00Z',
    '2099-01-01T00:00:00Z',
  ])('rejects an unapproved deadline %s', (expiresAt) => {
    expect(prefundedCardKnownDeadlineSchema.safeParse(expiresAt).success).toBe(
      false
    );
  });
});
