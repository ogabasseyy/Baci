import { describe, expect, it, vi } from 'vitest';
import type { SavingsExitTransfer } from '@/schemas/savings-exit-execution';
import { createSavingsExitExecution } from './savings-exit-execution';

vi.mock('server-only', () => ({}));
const scope = {
  integrationId: '40000000-0000-4000-8000-000000000001',
  merchantId: '10000000-0000-4000-8000-000000000001',
  customerId: '20000000-0000-4000-8000-000000000001',
  goalId: '30000000-0000-4000-8000-000000000001',
  expectedBusinessId: 'synthetic-business',
  actorId: '90000000-0000-4000-8000-000000000001',
};
const operationId = '80000000-0000-4000-8000-000000000001';
const policy = {
  policyId: '70000000-0000-4000-8000-000000000001',
};
const transfer: SavingsExitTransfer = {
  action: 'cancellation',
  operationId,
  reference: operationId,
  sourceWalletId: 'savings-wallet',
  destinationWalletId: 'customer-wallet',
  amountKobo: 100,
  currency: 'NGN',
};

function runtime(options: {
  state: 'submit' | 'verify' | 'pending_projection' | 'deferred';
  action?: 'purchase' | 'cancellation';
  policy?: unknown;
  finality?: 'success' | 'pending' | 'failed' | 'unknown';
}) {
  const execute = vi.fn(async (statement: string) => {
    if (statement.includes('consume_evidence')) {
      return {
        rows: [
          {
            result: {
              state:
                options.state === 'pending_projection'
                  ? 'pending_projection'
                  : 'pending',
              operationId,
            },
          },
        ],
      };
    }
    if (statement.includes('.begin(')) {
      return {
        rows: [
          {
            result: {
              state: options.policy ? options.state : 'deferred',
              operationId,
              ...(options.policy ? { transfer } : {}),
            },
          },
        ],
      };
    }
    return {
      rows: [
        {
          result: {
            state:
              options.finality === 'success'
                ? 'pending_projection'
                : options.finality === 'failed'
                  ? 'requires_reconciliation'
                  : 'pending',
            operationId,
          },
        },
      ],
    };
  });
  const submit = vi.fn(async () => ({ status: 'pending' as const }));
  const verify = vi.fn(async () => ({
    status: options.finality ?? 'success',
    ...transfer,
  }));
  return {
    execution: createSavingsExitExecution({
      configuration: scope,
      execute,
      policy: options.policy,
      action: options.action ?? 'cancellation',
      transferProvider: { submit, verify },
    }),
    execute,
    submit,
    verify,
  };
}

describe('savings exit execution', () => {
  it('refuses an unconfigured exit before attempting a provider transfer', async () => {
    const test = runtime({ state: 'deferred' });

    await expect(test.execution.execute({ operationId })).resolves.toEqual({
      status: 'requires_owner_approval',
      operationId,
    });
    expect(test.submit).not.toHaveBeenCalled();
    expect(test.verify).not.toHaveBeenCalled();
  });

  it('refuses a self-provisioned policy that includes wallet routing', async () => {
    const test = runtime({
      state: 'submit',
      policy: {
        ...policy,
        purchase: { sourceWalletId: 'attacker-wallet' },
      },
    });

    await expect(test.execution.execute({ operationId })).resolves.toEqual({
      status: 'requires_owner_approval',
      operationId,
    });
    expect(test.execute).not.toHaveBeenCalled();
    expect(test.submit).not.toHaveBeenCalled();
  });

  it('does not accept an echoed provider success as terminal evidence', async () => {
    const test = runtime({
      state: 'submit',
      policy,
      finality: 'success',
    });

    await expect(test.execution.execute({ operationId })).resolves.toEqual({
      status: 'pending_verification',
      operationId,
    });
    expect(test.submit).toHaveBeenCalledOnce();
    expect(test.verify).toHaveBeenCalledOnce();
    expect(test.execute).toHaveBeenCalledTimes(2);
  });

  it('uses verification only after an unknown transport result', async () => {
    const test = runtime({ state: 'verify', policy, finality: 'unknown' });

    await expect(test.execution.execute({ operationId })).resolves.toEqual({
      status: 'pending_verification',
      operationId,
    });
    expect(test.submit).not.toHaveBeenCalled();
    expect(test.verify).toHaveBeenCalledOnce();
  });

  it('quarantines finality that changes the prepared transfer amount', async () => {
    const test = runtime({ state: 'verify', policy, finality: 'success' });
    test.verify.mockResolvedValueOnce({
      ...transfer,
      status: 'success',
      amountKobo: 99,
    });

    await expect(test.execution.execute({ operationId })).resolves.toEqual({
      status: 'quarantined',
      operationId,
    });
    expect(test.execute).toHaveBeenCalledTimes(2);
  });

  it('does not execute a purchase acknowledgement through the cancellation lane', async () => {
    const test = runtime({
      state: 'submit',
      policy,
      action: 'cancellation',
    });
    test.execute.mockResolvedValueOnce({
      rows: [
        {
          result: {
            state: 'submit',
            operationId,
            transfer: {
              ...transfer,
              action: 'purchase',
            } as SavingsExitTransfer,
          },
        },
      ],
    });

    await expect(test.execution.execute({ operationId })).resolves.toEqual({
      status: 'quarantined',
      operationId,
    });
    expect(test.submit).not.toHaveBeenCalled();
    expect(test.verify).not.toHaveBeenCalled();
  });

  it.each([
    ['a stale policy revision', 'deferred'],
    ['a principal shortfall', 'deferred'],
    ['a fee that leaves no payable principal', 'deferred'],
  ] as const)('defers %s without provider activity', async (_reason, state) => {
    const test = runtime({ state, policy });

    await expect(test.execution.execute({ operationId })).resolves.toEqual({
      status: 'requires_owner_approval',
      operationId,
    });
    expect(test.submit).not.toHaveBeenCalled();
    expect(test.verify).not.toHaveBeenCalled();
  });

  it('does not submit again after a crash leaves the transfer verification-only', async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [{ result: { state: 'submit', operationId, transfer } }],
      })
      .mockResolvedValueOnce({
        rows: [{ result: { state: 'verify', operationId, transfer } }],
      })
      .mockResolvedValueOnce({
        rows: [{ result: { state: 'pending', operationId } }],
      })
      .mockResolvedValueOnce({
        rows: [{ result: { state: 'pending', operationId } }],
      });
    const submit = vi.fn(async () => {
      throw new Error('response lost after provider acceptance');
    });
    const verify = vi.fn(async () => ({
      ...transfer,
      status: 'success' as const,
    }));
    const execution = createSavingsExitExecution({
      configuration: scope,
      execute,
      policy,
      action: 'cancellation',
      transferProvider: { submit, verify },
    });

    await expect(execution.execute({ operationId })).resolves.toEqual({
      status: 'pending_verification',
      operationId,
    });
    await expect(execution.execute({ operationId })).resolves.toEqual({
      status: 'pending_verification',
      operationId,
    });
    expect(submit).toHaveBeenCalledOnce();
    expect(verify).toHaveBeenCalledOnce();
  });

  it('does not cross-settle a different goal or merchant operation', async () => {
    const test = runtime({ state: 'verify', policy, finality: 'success' });
    test.execute.mockResolvedValueOnce({
      rows: [
        {
          result: {
            state: 'verify',
            operationId: '80000000-0000-4000-8000-000000000002',
            transfer,
          },
        },
      ],
    });

    await expect(test.execution.execute({ operationId })).resolves.toEqual({
      status: 'pending_verification',
      operationId,
    });
    expect(test.submit).not.toHaveBeenCalled();
    expect(test.verify).not.toHaveBeenCalled();
  });

  it('does not call the provider again for an exit awaiting projection', async () => {
    const test = runtime({ state: 'pending_projection', policy });

    await expect(test.execution.execute({ operationId })).resolves.toEqual({
      status: 'pending_projection',
      operationId,
    });
    expect(test.submit).not.toHaveBeenCalled();
    expect(test.verify).not.toHaveBeenCalled();
  });

  it('requires reconciliation after a failed provider finality', async () => {
    const test = runtime({ state: 'verify', policy, finality: 'failed' });

    await expect(test.execution.execute({ operationId })).resolves.toEqual({
      status: 'requires_reconciliation',
      operationId,
    });
    expect(test.submit).not.toHaveBeenCalled();
    expect(test.verify).toHaveBeenCalledOnce();
  });
});
