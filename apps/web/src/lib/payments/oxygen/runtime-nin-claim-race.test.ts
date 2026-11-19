import { expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { performOxygenAction } from './runtime-service';

it('does not dispatch NIN again when the queued command was claimed before continuation', async () => {
  const id = '60000000-0000-4000-8000-000000000001';
  const key = '70000000-0000-4000-8000-000000000001';
  const snapshot = {
    workflowId: id,
    stage: 'kyc_required',
    version: 3,
    environment: 'staging',
    executionEnabled: true,
    state: {
      applicationReference: id,
      validated: true,
      eligible: true,
      kyc: {
        address_status: 'NOT_DONE',
        bvn_status: 'DONE',
        nin_status: 'NOT_DONE',
        bank_status: 'NOT_DONE',
        phone_status: 'DONE',
        selfie_status: 'DONE',
      },
    },
    pending: {
      action: 'validate_nin',
      status: 'executing',
      idempotencyKey: key,
    },
    approvalOtpReady: false,
    activationEnabled: false,
    settlementEnabled: false,
  };
  const user = {
    rpc: vi.fn(async (_name: string, args: Record<string, unknown>) =>
      args.p_operation === 'status'
        ? { data: snapshot, error: null }
        : { data: { commandId: id, status: 'executing' }, error: null }
    ),
  };
  const worker = {
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
  };
  const call = vi.fn();
  const result = await performOxygenAction(
    user,
    async () => worker,
    { call },
    'partner',
    new Set(),
    {
      workflowId: id,
      version: 3,
      idempotencyKey: key,
      command: { action: 'validate_nin' },
    }
  );
  expect(result.pending?.status).toBe('executing');
  expect(user.rpc).toHaveBeenCalledWith(
    'oxygen_runtime',
    expect.objectContaining({
      p_operation: 'enqueue',
      p_payload: expect.objectContaining({ idempotencyKey: key }),
    })
  );
  expect(worker.rpc).toHaveBeenCalledOnce();
  expect(call).not.toHaveBeenCalled();
});
