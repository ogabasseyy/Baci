import { expect, it, vi } from 'vitest';
import { createPiggyvestDraftClosureClient } from './piggyvest-draft-closure-client';

const goalId = 'abcdefab-0000-4000-8000-000000000816';
it('uses exact local GET and rejects fabricated authority before dispatch', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(async (url) => {
    const response = Response.json({
      goalId,
      status: 'requires_reconciliation',
      reason: 'provider_zero_unverified',
    });
    Object.defineProperty(response, 'url', { value: String(url) });
    return response;
  });
  const client = createPiggyvestDraftClosureClient({
    goalId,
    configuration: {
      mode: 'local_test',
      baseUrl: 'http://127.0.0.1:3000',
      endpointPath: '/close-plan',
    },
    fetch,
    getCsrfToken: async () => 'synthetic',
    isCurrent: () => true,
  });
  expect((await client.read()).status).toBe('requires_reconciliation');
  await expect(client.close({ goalId, providerEmpty: true })).rejects.toThrow();
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch.mock.calls[0][0]).toBe(
    `http://127.0.0.1:3000/close-plan?goalId=${goalId}`
  );
});
