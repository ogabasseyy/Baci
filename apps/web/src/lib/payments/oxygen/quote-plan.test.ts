// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const m = vi.hoisted(() => ({ read: vi.fn(), perform: vi.fn() }));
vi.mock('./runtime-service', () => ({
  readOxygenSnapshot: m.read,
  performOxygenAction: m.perform,
}));

import { OxygenProviderFailure } from './provider';
import { quoteOxygenPlan } from './quote-plan';

const id = '60000000-0000-4000-8000-000000000001';
const ref = '70000000-0000-4000-8000-000000000001';
const booking = {
  loan_reference: ref,
  product_amount: 400000,
  equity_percentage: 35,
  equity_amount: 140000,
  loan_amount: 260000,
  loan_tenure: 6,
  status: 'BOOKED' as const,
};
const kyc = {
  bvn_status: 'DONE',
  nin_status: 'DONE',
  bank_status: 'DONE',
  phone_status: 'DONE',
  selfie_status: 'DONE',
  address_status: 'DONE',
};
const state = {
  bookingReference: ref,
  booking,
  kyc,
  validated: true,
  eligible: true,
  maxTenure: 12,
};
const snapshot = {
  workflowId: id,
  stage: 'approval_required',
  environment: 'staging',
  version: 3,
  executionEnabled: true,
  approvalOtpReady: false,
  state,
  activationEnabled: false,
  settlementEnabled: false,
};
const plan = {
  bookingReference: ref,
  productAmount: 400000,
  equityPercentage: 35,
  tenure: 6,
  state: {
    bookingReference: ref,
    booking,
    quotedCharges: 5000,
    schedule: Array.from({ length: 6 }, (_, i) => ({
      period: i + 1,
      dueDate: [2026, 11, i + 1],
      amount: 50000,
      principal: 45000,
      interest: 5000,
    })),
  },
  updatedAt: '2026-10-24T10:00:00Z',
};
const input = {
  workflowId: id,
  idempotencyKey: id,
  equityPercentage: 35,
  tenure: 6,
};
const rpc = vi.fn();
const user = { rpc };
const connection = {
  provider: { call: vi.fn() },
  worker: vi.fn(),
  partnerReference: 'partner',
  hosts: new Set<string>(),
};
beforeEach(() => {
  vi.resetAllMocks();
  m.read.mockResolvedValue(snapshot);
  m.perform.mockResolvedValue(snapshot);
  rpc.mockResolvedValue({
    data: { plans: [plan], selectedReference: ref },
    error: null,
  });
});
it('returns the exact cached tenure with no provider execution', async () => {
  const result = await quoteOxygenPlan(user, connection, input);
  expect(result.selectedReference).toBe(ref);
  expect(m.perform).not.toHaveBeenCalled();
});
it('books an uncached tenure once, reads details, and persists the cached selection', async () => {
  m.read.mockResolvedValue({
    ...snapshot,
    state: { ...state, booking: { ...booking, loan_tenure: 3 } },
  });
  rpc.mockResolvedValueOnce({
    data: { plans: [], selectedReference: null },
    error: null,
  });
  await quoteOxygenPlan(user, connection, input);
  expect(m.perform.mock.calls.map((call) => call[5].command.action)).toEqual([
    'book',
    'refresh_details',
  ]);
  expect(m.perform.mock.calls[0][5].idempotencyKey).toBe(id);
  expect(rpc).toHaveBeenLastCalledWith('oxygen_saved_plans', {
    p_workflow_id: id,
    p_booking_reference: ref,
  });
});
it('retries only details after a confirmed booking whose schedule was not saved', async () => {
  rpc.mockResolvedValueOnce({
    data: { plans: [], selectedReference: null },
    error: null,
  });
  await quoteOxygenPlan(user, connection, input);
  expect(m.perform.mock.calls.map((call) => call[5].command.action)).toEqual([
    'refresh_details',
  ]);
});
it('does not retry a booking after response loss', async () => {
  m.read.mockResolvedValue({
    ...snapshot,
    state: { ...state, booking: { ...booking, loan_tenure: 3 } },
  });
  rpc.mockResolvedValueOnce({
    data: { plans: [], selectedReference: null },
    error: null,
  });
  m.perform.mockRejectedValueOnce(new OxygenProviderFailure('indeterminate'));
  await expect(quoteOxygenPlan(user, connection, input)).rejects.toThrow();
  expect(m.perform).toHaveBeenCalledTimes(1);
});
it.each([
  { stage: 'reconciliation_required' },
  { pending: { action: 'book', status: 'indeterminate' } },
  { approvalOtpReady: true },
  { state: { ...state, booking: { ...booking, status: 'APPROVED' } } },
])('blocks new provider work for unsafe state %j', async (change) => {
  rpc.mockResolvedValue({
    data: { plans: [], selectedReference: null },
    error: null,
  });
  m.read.mockResolvedValue({ ...snapshot, ...change });
  await expect(quoteOxygenPlan(user, connection, input)).rejects.toThrow(
    'blocked'
  );
  expect(m.perform).not.toHaveBeenCalled();
});
it('enforces the provider operation allowlist even if orchestration tries approval', async () => {
  rpc.mockResolvedValueOnce({
    data: { plans: [], selectedReference: null },
    error: null,
  });
  m.perform.mockImplementationOnce(async (...args) => {
    await args[2].call('approve', {});
  });
  await expect(quoteOxygenPlan(user, connection, input)).rejects.toThrow(
    'blocked'
  );
  expect(connection.provider.call).not.toHaveBeenCalled();
});

it('keeps command-scoped evidence binding and the operation allowlist together', async () => {
  rpc.mockResolvedValueOnce({
    data: { plans: [], selectedReference: null },
    error: null,
  });
  const call = vi.fn().mockResolvedValue({});
  const bind = vi.fn().mockReturnValue({ call });
  m.perform.mockImplementationOnce(async (...args) => {
    const bound = args[2].forCommand(user, id, ref);
    await bound.call('details', {});
    expect(() => bound.call('approve', {})).toThrow('blocked');
    return snapshot;
  });
  await quoteOxygenPlan(
    user,
    { ...connection, provider: { call, forCommand: bind } },
    input
  );
  expect(bind).toHaveBeenCalledWith(user, id, ref);
  expect(call).toHaveBeenCalledExactlyOnceWith('details', {});
});
