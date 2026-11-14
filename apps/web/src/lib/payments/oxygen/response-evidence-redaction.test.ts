import { expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { projectOxygenResponse } from './response-evidence';

it('redacts identity and credential patterns at the final evidence boundary', () => {
  const evidence = projectOxygenResponse(
    {
      operation: 'nin',
      httpStatus: 500,
      requestId: null,
      capture: 'parsed',
      durationMs: 1,
      failure: {
        providerMessage:
          'Check 12345678901 for person@example.test at https://provider.test/a?token=secret',
        providerCode: 'BAD_12345678901',
        details: [
          'Bearer synthetic-token',
          'Invalid NIN 12345678901',
          'Authorization: synthetic-secret',
        ],
      },
    },
    new Set()
  );
  const stored = JSON.stringify(evidence);
  expect(stored).not.toMatch(
    /12345678901|person@example\.test|synthetic-token|synthetic-secret|provider\.test/
  );
  expect(evidence.failure?.details).toContain('Invalid NIN [redacted]');
  expect(evidence.failure?.providerCode).toBeNull();
});

it('keeps bounded useful provider failure context and safe codes', () => {
  const evidence = projectOxygenResponse(
    {
      operation: 'nin',
      httpStatus: 400,
      requestId: null,
      capture: 'parsed',
      durationMs: 1,
      failure: {
        providerMessage: 'Identity service unavailable',
        providerCode: 'ERR_42',
        details: ['Please retry later'],
      },
    },
    new Set()
  );
  expect(evidence.failure).toEqual({
    providerMessage: 'Identity service unavailable',
    providerCode: 'ERR_42',
    details: ['Please retry later'],
  });
});
