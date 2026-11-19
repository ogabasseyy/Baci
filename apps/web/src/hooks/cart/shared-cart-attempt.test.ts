import { expect, it, vi } from 'vitest';
import { AttemptAdmissionDenied } from '@/lib/api-client';
import * as csrf from '@/lib/csrf';
import { sendSharedCartCommand } from './shared-cart-client';

it('does not convert admission denial into retryable transport failure', async () => {
  vi.spyOn(csrf, 'getClientCsrfToken').mockReturnValue('token');
  const fetch = vi.spyOn(globalThis, 'fetch');
  try {
    const result = await sendSharedCartCommand(
      {
        operationId: 'synthetic-op',
        expectedVersion: 1,
        command: { type: 'clear' },
      },
      'qa',
      {
        beforeAttempt: () => ({ allowed: false, code: 'STALE_ROUTE' }),
        onAttemptStart: vi.fn(),
      }
    );
    expect(result).toMatchObject({
      ok: false,
      retryable: false,
      admissionDenied: true,
      attempted: false,
    });
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    vi.restoreAllMocks();
  }
  expect(
    new AttemptAdmissionDenied('STALE_ROUTE', false, 'none').message
  ).not.toContain('token');
});
