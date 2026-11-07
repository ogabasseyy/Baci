import { wholeSecondTimestampSchema } from './whole-second-timestamp';

describe('whole-second timestamp schema', () => {
  it.each([
    '2026-09-08T12:00:00.000Z',
    '2024-02-29T23:59:59.000Z',
  ])('accepts a real canonical timestamp %s', (value) => {
    expect(wholeSecondTimestampSchema.safeParse(value).success).toBe(true);
  });

  it.each([
    '2026-09-08T12:00:00.001Z',
    '2026-09-08T12:00:00.000+01:00',
    '2026-02-29T00:00:00.000Z',
    '2026-13-01T00:00:00.000Z',
    '2026-01-01T25:00:00.000Z',
  ])('rejects an invalid or noncanonical timestamp %s', (value) => {
    expect(wholeSecondTimestampSchema.safeParse(value).success).toBe(false);
  });
});
