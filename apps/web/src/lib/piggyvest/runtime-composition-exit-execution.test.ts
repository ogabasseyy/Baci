import { NextRequest } from 'next/server';
import { expect, it, vi } from 'vitest';
import { createFundingScreenFixture } from './customer-funding-screen.test-fixture';
import { dispatchRuntimeComposition } from './runtime-composition-routes';

vi.mock('server-only', () => ({}));

const handler = vi.hoisted(() => vi.fn());

vi.mock('./savings-exit-execution-handler', () => ({
  createSavingsExitExecutionHandler: handler,
}));

const policy = {
  policyId: '70000000-0000-4000-8000-000000000001',
};

it('routes enabled savings exits through the authenticated server-only executor', async () => {
  handler.mockReturnValue({
    POST: async () => Response.json({ status: 'pending_verification' }),
  });
  const common = createFundingScreenFixture().options;
  const transferProvider = {
    submit: async () => ({ status: 'pending' as const }),
    verify: async (transfer: {
      action: 'purchase' | 'cancellation';
      operationId: string;
      reference: string;
      sourceWalletId: string;
      destinationWalletId: string;
      amountKobo: number;
      currency: 'NGN';
    }) => ({ ...transfer, status: 'unknown' as const }),
  };

  const response = await dispatchRuntimeComposition(
    new NextRequest('http://127.0.0.1/purchase/execute', { method: 'POST' }),
    common,
    {
      exitExecution: {
        enabled: true,
        policies: { purchase: policy },
        transferProvider,
      },
    }
  );

  expect(response.status).toBe(200);
  expect(handler).toHaveBeenCalledOnce();
  expect(handler.mock.calls[0][0]).toMatchObject({
    ...common,
    policy,
    transferProvider,
    action: 'purchase',
  });
});

it('binds each execution path to its immutable server-side action', async () => {
  handler.mockReturnValue({
    POST: async () => Response.json({ status: 'pending_verification' }),
  });
  const common = createFundingScreenFixture().options;
  const transferProvider = {
    submit: async () => ({ status: 'pending' as const }),
    verify: async (transfer: {
      action: 'purchase' | 'cancellation';
      operationId: string;
      reference: string;
      sourceWalletId: string;
      destinationWalletId: string;
      amountKobo: number;
      currency: 'NGN';
    }) => ({ ...transfer, status: 'unknown' as const }),
  };

  await dispatchRuntimeComposition(
    new NextRequest('http://127.0.0.1/purchase/execute', { method: 'POST' }),
    common,
    {
      exitExecution: {
        enabled: true,
        policies: { purchase: policy },
        transferProvider,
      },
    }
  );
  await dispatchRuntimeComposition(
    new NextRequest('http://127.0.0.1/cancel/execute', { method: 'POST' }),
    common,
    {
      exitExecution: {
        enabled: true,
        policies: { cancellation: policy },
        transferProvider,
      },
    }
  );

  expect(handler.mock.calls.at(-2)?.[0].action).toBe('purchase');
  expect(handler.mock.calls.at(-1)?.[0].action).toBe('cancellation');
});
