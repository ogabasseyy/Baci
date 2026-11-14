import { beforeEach, expect, it, vi } from 'vitest';
import type { OxygenRuntimeSnapshot } from '@/schemas/oxygen-runtime-view';

const report = vi.hoisted(() => vi.fn());
vi.mock('./error-report', () => ({ readOxygenErrorReport: report }));

import { restoreOxygenEligibilityRecovery } from './restore-eligibility-recovery';

const id = '60000000-0000-4000-8000-000000000079';
const snapshot: OxygenRuntimeSnapshot = {
  workflowId: id,
  stage: 'eligibility_required',
  version: 4,
  environment: 'staging',
  executionEnabled: true,
  state: {
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
  },
  checkoutAddress: {},
  checkoutPhone: '',
  approvalOtpReady: false,
  activationEnabled: false,
  settlementEnabled: false,
};
const failure = {
  workflowId: id,
  applicationReference: id,
  action: 'refresh_eligibility',
  status: 'failed',
  diagnostic: { operation: 'eligibility', providerMessage: 'private details' },
};
beforeEach(() => vi.clearAllMocks());
it('restores a failed eligibility flag without exposing diagnostics or changing identity', async () => {
  report.mockResolvedValue([failure]);
  const client = { rpc: vi.fn() };
  const worker = vi.fn().mockResolvedValue(client);
  const result = await restoreOxygenEligibilityRecovery(snapshot, worker);
  expect(report).toHaveBeenCalledExactlyOnceWith(client, id);
  expect(result.state).toEqual({
    ...snapshot.state,
    eligibilityStatus: 'failed',
  });
  expect(result.version).toBe(snapshot.version);
  expect(JSON.stringify(result)).not.toContain('private details');
  expect(client.rpc).not.toHaveBeenCalled();
});
it('allows a fresh application to follow its first eligibility check', async () => {
  report.mockResolvedValue([]);
  expect(await restoreOxygenEligibilityRecovery(snapshot, vi.fn())).toBe(
    snapshot
  );
});
it('ignores errors belonging to a different application', async () => {
  report.mockResolvedValue([{ ...failure, applicationReference: 'other' }]);
  expect(await restoreOxygenEligibilityRecovery(snapshot, vi.fn())).toBe(
    snapshot
  );
});
it.each([
  { state: { ...snapshot.state, eligible: true } },
  { state: { ...snapshot.state, bookingReference: id } },
  { state: { ...snapshot.state, validated: false } },
  { pending: { action: 'book', status: 'indeterminate', idempotencyKey: id } },
] satisfies Partial<OxygenRuntimeSnapshot>[])('never inspects or overrides completed or pending progress', async (change) => {
  const worker = vi.fn();
  const current = { ...snapshot, ...change };
  expect(await restoreOxygenEligibilityRecovery(current, worker)).toBe(current);
  expect(worker).not.toHaveBeenCalled();
  expect(report).not.toHaveBeenCalled();
});
