import { describe, expect, it } from 'vitest';
import { jumiaOAuthDiagnosticIdSchema } from './oauth-diagnostic';

describe('jumiaOAuthDiagnosticIdSchema', () => {
  it('accepts an RFC-compatible UUID', () => {
    expect(
      jumiaOAuthDiagnosticIdSchema.safeParse(
        '11111111-1111-4111-8111-111111111111'
      ).success
    ).toBe(true);
  });

  it.each([
    undefined,
    '',
    'not-a-uuid',
  ])('rejects an invalid diagnostic ID %s', (value) => {
    expect(jumiaOAuthDiagnosticIdSchema.safeParse(value).success).toBe(false);
  });
});
