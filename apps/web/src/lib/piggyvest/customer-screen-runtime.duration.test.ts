import type { SupabaseClient } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';
import { expect, it, vi } from 'vitest';
import { resolvePiggyvestCustomerPolicyContext } from './customer-policy-context';
import { createPiggyvestCustomerPolicyHandler } from './customer-policy-handler';
import { createPiggyvestCustomerScreenRuntime } from './customer-screen-runtime';
import { GOAL_LIFECYCLE_STATEMENTS } from './goal-lifecycle-statements';

vi.mock('server-only', () => ({}));
vi.mock('./customer-policy-context', () => ({
  resolvePiggyvestCustomerPolicyContext: vi.fn(),
}));
vi.mock('./customer-policy-handler', () => ({
  createPiggyvestCustomerPolicyHandler: vi.fn(),
}));

it('rejects a foreign actor in the eight-parameter duration acceptance before the executor', async () => {
  const actorId = '90000000-0000-4000-8000-000000000001';
  const configuration = {
    environment: 'staging' as const,
    integrationId: '40000000-0000-4000-8000-000000000001',
    merchantId: '10000000-0000-4000-8000-000000000001',
    customerId: '20000000-0000-4000-8000-000000000001',
    goalId: '30000000-0000-4000-8000-000000000001',
    expectedBusinessId: 'synthetic-business',
  };
  vi.mocked(resolvePiggyvestCustomerPolicyContext).mockResolvedValue({
    status: 'ready',
    actorId,
    configuration,
  });
  vi.mocked(createPiggyvestCustomerPolicyHandler).mockImplementation(
    (options) => {
      async function handle(request: NextRequest) {
        await options.authenticate(request);
        try {
          await options.execute(
            GOAL_LIFECYCLE_STATEMENTS.acceptGoalLifecycleTerms.text,
            [
              configuration.integrationId,
              configuration.merchantId,
              configuration.customerId,
              configuration.goalId,
              configuration.expectedBusinessId,
              '70000000-0000-4000-8000-000000000001',
              '90000000-0000-4000-8000-000000000002',
              1,
            ]
          );
          return Response.json({ status: 'accepted' });
        } catch {
          return Response.json(
            { error: 'Policy unavailable' },
            { status: 503 }
          );
        }
      }
      return { GET: handle, POST: handle };
    }
  );
  const execute = vi.fn(async () => ({ rows: [] }));
  const runtime = createPiggyvestCustomerScreenRuntime({
    supabase: {
      auth: {
        getUser: async () => ({ data: { user: { id: actorId } }, error: null }),
      },
    } as unknown as SupabaseClient,
    configuration,
    goalId: configuration.goalId,
    termsDocument: {},
    execute,
    checkCsrfProtection: async () => ({ valid: true }),
  });
  const response = await runtime.POST(
    new NextRequest('http://localhost/policy', { method: 'POST' })
  );
  expect(response.status).toBe(503);
  expect(execute).not.toHaveBeenCalled();
});
