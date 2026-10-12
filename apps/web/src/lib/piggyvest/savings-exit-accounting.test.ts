import { describe, expect, it, vi } from 'vitest';
import { createSavingsExitExecution } from './savings-exit-execution';

const operationId = '30000000-0000-4000-8000-000000004212';
const configuration = {
  integrationId: '40000000-0000-4000-8000-000000000001',
  merchantId: '10000000-0000-4000-8000-000000000001',
  customerId: '20000000-0000-4000-8000-000000000001',
  goalId: '30000000-0000-4000-8000-000000000212',
  actorId: '90000000-0000-4000-8000-000000000001',
  expectedBusinessId: 'synthetic-business',
};
const transfer = {
  action: 'purchase' as const,
  operationId,
  reference: operationId,
  sourceWalletId: 'source',
  destinationWalletId: 'destination',
  amountKobo: 99150,
  currency: 'NGN' as const,
};
function harness(
  state: 'submit' | 'verify' | 'pending_projection',
  accounting: string
) {
  const execute = vi.fn(async (statement: string) => ({
    rows: [
      {
        result: statement.includes('consume_evidence')
          ? { state: accounting, operationId }
          : {
              state,
              operationId,
              ...(state === 'pending_projection' ? {} : { transfer }),
            },
      },
    ],
  }));
  const transferProvider = {
    submit: vi.fn(async () => ({ status: 'pending' as const })),
    verify: vi.fn(async () => ({ ...transfer, status: 'success' as const })),
  };
  const service = createSavingsExitExecution({
    configuration,
    execute,
    action: 'purchase',
    policy: { policyId: '70000000-0000-4000-8000-000000000212' },
    transferProvider,
  });
  return {
    execute,
    transferProvider,
    run: () => service.execute({ operationId }),
  };
}

describe('execution consumes independent exit accounting evidence', () => {
  it('calls the durable consumer after submission without passing echoed finality', async () => {
    const test = harness('submit', 'accounted');
    expect(await test.run()).toEqual({ status: 'accounted', operationId });
    expect(test.execute).toHaveBeenLastCalledWith(
      expect.stringContaining('consume_evidence'),
      [
        configuration.integrationId,
        configuration.merchantId,
        configuration.customerId,
        configuration.goalId,
        configuration.expectedBusinessId,
        configuration.actorId,
        operationId,
        'purchase',
      ]
    );
    expect(test.transferProvider.submit).toHaveBeenCalledOnce();
  });
  it('recovers committed evidence after restart without dispatching or trusting a verifier', async () => {
    const test = harness('verify', 'accounted');
    expect(await test.run()).toEqual({ status: 'accounted', operationId });
    expect(test.transferProvider.submit).not.toHaveBeenCalled();
    expect(test.transferProvider.verify).not.toHaveBeenCalled();
  });
  it('retries a pending projection without provider I/O', async () => {
    const test = harness('pending_projection', 'accounted');
    expect(await test.run()).toEqual({ status: 'accounted', operationId });
    expect(test.transferProvider.verify).not.toHaveBeenCalled();
  });
  it('does not finalize an echoed positive verifier without a committed receipt', async () => {
    expect(await harness('submit', 'pending').run()).toEqual({
      status: 'pending_verification',
      operationId,
    });
  });
});
