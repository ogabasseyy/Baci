import { expect, it, vi } from 'vitest';
import { createPiggyvestDraftClosureClientBinding } from './piggyvest-draft-closure-client-binding';

it.each([
  'session',
  'sibling',
] as const)('prevents POST after %s replacement during CSRF', async (replacement) => {
  const goalId = 'abcdefab-0000-4000-8000-000000000816';
  const source = {
    environment: 'staging',
    status: 'ready',
    sessionKey: 'session',
    goalId,
    policy: {
      status: 'draft',
      goalId,
      revisionId: goalId,
      device: { productName: 'Synthetic', variant: null, condition: 'New' },
      terms: { version: 'synthetic', hash: 'a'.repeat(64), text: 'Plain' },
      consent: 'accepted',
    },
    eligibility: { status: 'blocked' },
    funding: { status: 'unavailable' },
    progress: { status: 'unavailable' },
  };
  let current = true;
  let compatible = true;
  const fetch = vi.fn<typeof globalThis.fetch>(async (url) => {
    const response = Response.json({
      status: 'available',
      goalId,
      revisionId: goalId,
      termsVersion: 'synthetic',
      termsHash: 'a'.repeat(64),
      action: 'close_plan',
    });
    Object.defineProperty(response, 'url', { value: String(url) });
    return response;
  });
  const binding = await createPiggyvestDraftClosureClientBinding({
    source,
    tenantKey: 'tenant',
    operationId: goalId,
    isCurrent: () => current,
    http: {
      configuration: {
        mode: 'local_test',
        baseUrl: 'http://127.0.0.1:3000',
        endpointPath: '/close-plan',
      },
      fetch,
      getCsrfToken: async () => {
        if (replacement === 'session') current = false;
        else compatible = false;
        return 'synthetic';
      },
    },
  });
  binding.setCompatibilityGuard(() => compatible);
  await expect(
    binding.close(true, binding.read(source)?.reviewVersion)
  ).rejects.toThrow();
  expect(fetch).toHaveBeenCalledTimes(1);
  if (replacement === 'session') expect(binding.read(source)).toBeNull();
  else expect(binding.read(source)?.status).toBe('uncertain');
});
