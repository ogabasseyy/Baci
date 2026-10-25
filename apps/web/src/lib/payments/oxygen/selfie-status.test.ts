import { beforeEach, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ read: vi.fn(), rpc: vi.fn() }));
vi.mock('./runtime-service', () => ({
  readOxygenSnapshot: m.read,
  oxygenRuntimeRpc: m.rpc,
}));

import { readOxygenSelfieStatus } from './selfie-status';

const id = '60000000-0000-4000-8000-000000000001';
const snapshot = {
  workflowId: id,
  stage: 'reconciliation_required',
  version: 4,
  environment: 'staging',
  executionEnabled: true,
  state: {
    validated: true,
    applicationReference: id,
    selfieUrl: 'https://host.test/',
  },
  approvalOtpReady: false,
  checkoutPhone: '',
  checkoutAddress: {},
  activationEnabled: false,
  settlementEnabled: false,
  pending: {
    action: 'validate_nin',
    status: 'indeterminate',
    idempotencyKey: id,
  },
};
const user = { rpc: vi.fn() };
const worker = { rpc: vi.fn() };
const makeWorker = vi.fn();
const call = vi.fn();
beforeEach(() => {
  vi.resetAllMocks();
  m.read.mockResolvedValue(snapshot);
  m.rpc.mockResolvedValue(snapshot);
  makeWorker.mockResolvedValue(worker);
  call.mockResolvedValue({
    phone_status: 'DONE',
    bvn_status: 'NOT_DONE',
    nin_status: 'NOT_DONE',
    selfie_status: 'DONE',
    bank_status: 'NOT_DONE',
    address_status: 'NOT_DONE',
  });
});
it('reads only KYC for the same owned application while leaving NIN untouched', async () => {
  const result = await readOxygenSelfieStatus(
    user,
    makeWorker,
    { call },
    'partner',
    id
  );
  expect(result.confirmed).toBe(true);
  expect(call).toHaveBeenCalledExactlyOnceWith('kyc', {
    loan_request_reference: id,
    partner_reference: 'partner',
  });
  expect(m.rpc).toHaveBeenCalledExactlyOnceWith(worker, 'worker_status', id);
  expect(user.rpc).not.toHaveBeenCalled();
  expect(worker.rpc).not.toHaveBeenCalled();
});
it('does not access worker or provider before ownership is established', async () => {
  m.read.mockRejectedValue(new Error('not owned'));
  await expect(
    readOxygenSelfieStatus(user, makeWorker, { call }, 'partner', id)
  ).rejects.toThrow();
  expect(makeWorker).not.toHaveBeenCalled();
  expect(call).not.toHaveBeenCalled();
});
it('rejects worker/application binding mismatches before a provider read', async () => {
  m.rpc.mockResolvedValue({
    ...snapshot,
    state: {
      ...snapshot.state,
      applicationReference: '60000000-0000-4000-8000-000000000002',
    },
  });
  await expect(
    readOxygenSelfieStatus(user, makeWorker, { call }, 'partner', id)
  ).rejects.toThrow();
  expect(call).not.toHaveBeenCalled();
});
it('does not treat NOT_DONE or a malformed response as confirmation', async () => {
  call.mockResolvedValueOnce({
    phone_status: 'DONE',
    bvn_status: 'NOT_DONE',
    nin_status: 'NOT_DONE',
    selfie_status: 'NOT_DONE',
    bank_status: 'NOT_DONE',
    address_status: 'NOT_DONE',
  });
  expect(
    (await readOxygenSelfieStatus(user, makeWorker, { call }, 'partner', id))
      .confirmed
  ).toBe(false);
  call.mockResolvedValue({ selfie_status: 'DONE' });
  await expect(
    readOxygenSelfieStatus(user, makeWorker, { call }, 'partner', id)
  ).rejects.toThrow();
});
