import { expect, it, vi } from 'vitest';
import { performOxygenAction } from './runtime-service';

it('records the actual received HTTP status and failed schema field without response values', async () => {
  const id = '60000000-0000-4000-8000-000000000094';
  const command = { action: 'refresh_eligibility' as const };
  const state = {
    applicationReference: id,
    validated: true,
    kyc: {
      phone_status: 'DONE',
      bvn_status: 'DONE',
      selfie_status: 'DONE',
      nin_status: 'NOT_DONE',
      bank_status: 'NOT_DONE',
      address_status: 'NOT_DONE',
    },
  };
  const snapshot = {
    workflowId: id,
    stage: 'eligibility_required',
    version: 0,
    environment: 'staging',
    executionEnabled: true,
    state,
    approvalOtpReady: false,
    activationEnabled: false,
    settlementEnabled: false,
  };
  const user = {
    rpc: vi.fn(async (_name: string, args: Record<string, unknown>) => ({
      data:
        args.p_operation === 'status'
          ? snapshot
          : { commandId: id, status: 'queued' },
      error: null,
    })),
  };
  const worker = {
    rpc: vi.fn(async (_name: string, args: Record<string, unknown>) => ({
      data:
        args.p_operation === 'claim'
          ? {
              command,
              context: {
                workflowId: id,
                stage: 'eligibility_required',
                version: 0,
                environment: 'staging',
                partnerReference: 'partner-private',
                merchantReference: null,
                orderId: id,
                productAmount: 198000,
                orderPhone: '08012345678',
                productName: 'Phone',
                address: 'Private address',
                state,
              },
            }
          : {},
      error: null,
    })),
  };
  const call = vi.fn().mockResolvedValue({
    loan_request_reference: id,
    partner_reference: 'partner-private',
    status: 'COMPLETED',
    is_eligible: true,
    message: 'private-provider-message',
    eligible_amount: 'private-unexpected-value',
  });
  const provider = {
    call,
    responseMetadata: () => ({
      operation: 'eligibility' as const,
      httpStatus: 200,
      requestId: null,
      capture: 'parsed' as const,
      durationMs: 1464,
    }),
  };
  await expect(
    performOxygenAction(
      user,
      async () => worker,
      provider,
      'partner-private',
      new Set(),
      { workflowId: id, version: 0, idempotencyKey: id, command }
    )
  ).rejects.toThrow();
  const failure = worker.rpc.mock.calls.find(
    ([name]) => name === 'oxygen_finish_failure'
  );
  expect(failure).toBeDefined();
  expect(failure?.[1].p_diagnostic).toMatchObject({
    operation: 'eligibility',
    kind: 'invalid_response',
    httpStatus: 200,
    capture: 'parsed',
    providerCode: 'RESPONSE_SCHEMA_INVALID',
  });
  expect(JSON.stringify(failure?.[1].p_diagnostic)).toContain(
    'eligible_amount'
  );
  expect(JSON.stringify(failure?.[1].p_diagnostic)).not.toMatch(
    /private-unexpected-value|private-provider-message|partner-private|Private address/
  );
  expect(call).toHaveBeenCalledTimes(1);
});
