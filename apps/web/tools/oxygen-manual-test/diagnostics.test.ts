import { expect, it } from 'vitest';
import { safeProviderDiagnostic } from './diagnostics';

it('keeps useful validation wording while removing credentials and submitted values', () => {
  const result = safeProviderDiagnostic(
    {
      message:
        'Invalid BVN 12345678901 for Test Person test@example.com; secret private-key token bearer abcdefghijklmnopqrstuvwxyz',
    },
    {
      customer: {
        bvn: '12345678901',
        name: 'Test Person',
        email: 'test@example.com',
      },
    },
    ['private-key', 'abcdefghijklmnopqrstuvwxyz']
  );
  expect(result).toContain('Invalid BVN');
  for (const sensitive of [
    '12345678901',
    'Test Person',
    'test@example.com',
    'private-key',
    'abcdefghijklmnopqrstuvwxyz',
  ])
    expect(result).not.toContain(sensitive);
});
it('rejects structured messages and bounds output', () => {
  expect(
    safeProviderDiagnostic({ message: { secret: 'unsafe' } }, {}, [])
  ).toBeUndefined();
  expect(
    safeProviderDiagnostic({ message: 'a'.repeat(2000) }, {}, [])?.length
  ).toBeLessThanOrEqual(1000);
});
