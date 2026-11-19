import { describe, expect, it } from 'vitest';
import { postgresUuidSchema } from './postgres-uuid';

describe('postgresUuidSchema', () => {
  it.each([
    '44444444-4444-4444-8444-444444444444',
    '00000000-0000-0000-0000-000000000001',
    'ABCDEF01-2345-6789-ABCD-EF0123456789',
  ])('accepts %s', (value) => {
    expect(postgresUuidSchema.safeParse(value).success).toBe(true);
  });

  it.each([
    '',
    'not-a-uuid',
    '4444444444444444844444444444444',
    '44444444-4444-4444-8444-44444444444',
    '44444444-4444-4444-8444-4444444444444',
    '44444444-4444-4444-8444-44444444444g',
    ' 44444444-4444-4444-8444-444444444444',
    '44444444-4444-4444-8444-444444444444\n',
  ])('rejects %j', (value) => {
    expect(postgresUuidSchema.safeParse(value).success).toBe(false);
  });

  it('rejects non-string values', () => {
    expect(postgresUuidSchema.safeParse(undefined).success).toBe(false);
    expect(postgresUuidSchema.safeParse(12).success).toBe(false);
  });
});
