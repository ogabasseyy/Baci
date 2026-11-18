import { afterEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ after: vi.fn(), rpc: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('next/server', async (load) => ({
  ...(await load<typeof import('next/server')>()),
  after: mocks.after,
}));
vi.mock('@/lib/payments/oxygen/runtime-worker-client', () => ({
  createOxygenWorkerClient: () => async () => ({ rpc: mocks.rpc }),
}));
vi.mock('@/lib/payments/oxygen/runtime-provider-token-cache', () => ({
  oxygenRuntimeProviderToken: async () => ({ token: 'simulated-token' }),
}));

import { POST } from './route';

const id = '60000000-0000-4000-8000-000000000001';

afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it.each([
  true,
  false,
])('accepts a callback and activates only with completed repayment setup (%s)', async (setup) => {
  vi.stubEnv('VERCEL_ENV', 'production');
  const config = {
    RUNTIME_ENABLED: 'true',
    AUTOMATIC_ACTIVATION_ENABLED: 'true',
    PARTNER_REFERENCE: 'synthetic-partner',
    PARTNER_SECRET: 'synthetic-credential',
    WORKER_EMAIL: 'worker@example.test',
    WORKER_PASSWORD: 'synthetic-password',
    HOSTED_HOSTS: 'hosted.example.test',
    DRAFT_ENCRYPTION_KEY: 'a'.repeat(64),
    CALLBACK_KEY: 'synthetic-key',
    CALLBACK_SECRET: 'synthetic-secret',
  };
  for (const [key, value] of Object.entries(config))
    vi.stubEnv(`OXYGEN_PRODUCTION_${key}`, value);

  const operations: string[] = [];
  let activated = false;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      expect(JSON.parse(String(init.body))).toEqual({ loan_reference: id });
      if (url.endsWith('/split-payment-setup/confirmation')) {
        operations.push('provider-status');
        return Response.json({
          split_payment: { completed: true },
          repayment_setup: { completed: setup },
        });
      }
      if (url.endsWith('/activate-loan')) {
        operations.push('provider-activate');
        return Response.json({ loan_reference: id, status: 'ACTIVATED' });
      }
      throw new Error('Unexpected network call');
    })
  );

  mocks.rpc.mockImplementation(
    async (name: string, args: { p_operation?: string }) => {
      const response = (data: unknown) => ({ data, error: null });
      const operation = args.p_operation;
      switch (name) {
        case 'oxygen_callback':
          if (operation === 'accept') return response({ result: 'accepted' });
          if (operation === 'pending')
            return response([
              { id, kind: 'transaction', workflowIds: [id], retryKey: id },
            ]);
          operations.push(String(operation));
          return response(null);
        case 'oxygen_runtime':
          return response({
            environment: 'production',
            stage: activated ? 'activated' : 'payment_required',
            state: { paymentComplete: true, setupComplete: setup },
          });
        case 'oxygen_callback_payment':
          return response({
            commandId: id,
            reference: id,
            environment: 'production',
            status: 'queued',
          });
        case 'oxygen_payment_recovery':
          return response(
            operation === 'claim'
              ? {
                  reference: id,
                  action: 'check_status',
                  environment: 'production',
                }
              : { recorded: true }
          );
        case 'oxygen_general_activation':
          operations.push(`activation-${operation}`);
          if (operation === 'claim')
            return response({
              reference: id,
              attemptId: id,
              environment: 'production',
            });
          if (operation === 'reconcile') {
            activated = true;
            return response({ orderConfirmed: true });
          }
          return response({ recorded: true });
        default:
          throw new Error('Unexpected database operation');
      }
    }
  );

  const response = await POST(
    new Request('https://example.test/api/payments/oxygen/webhook', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        api_key: 'synthetic-key',
        api_secret: 'synthetic-secret',
      },
      body: JSON.stringify({
        webhook_type: 'split_payment',
        phone_number: '08000000000',
        transaction_reference: 'synthetic-transaction',
        amount_deducted: '100.00',
        amount_sent: '100.00',
        loan_request_reference: id,
      }),
    })
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ received: true });
  expect(mocks.after).toHaveBeenCalledOnce();
  await mocks.after.mock.calls[0][0]();
  expect(activated).toBe(setup);
  expect(operations).toEqual(
    setup
      ? [
          'provider-status',
          'activation-claim',
          'provider-activate',
          'activation-finish',
          'activation-reconcile',
          'complete',
        ]
      : ['provider-status', 'defer']
  );
});
