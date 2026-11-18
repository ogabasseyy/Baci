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

import { oxygenQuoteFixture } from './quote-plan.test-support';

const { id, ref, booking, state } = oxygenQuoteFixture;
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
it('resumes a queued comparison booking with its durable key after reload', async () => {
  const durableKey = '80000000-0000-4000-8000-000000000001';
  m.read.mockResolvedValue({
    ...snapshot,
    state: { ...state, booking: { ...booking, loan_tenure: 3 } },
    pending: { action: 'book', status: 'queued', idempotencyKey: durableKey },
  });
  rpc.mockResolvedValueOnce({
    data: { plans: [], selectedReference: null },
    error: null,
  });
  await quoteOxygenPlan(user, connection, {
    ...input,
    idempotencyKey: durableKey,
  });
  expect(m.perform.mock.calls[0][5]).toMatchObject({
    idempotencyKey: durableKey,
    command: { action: 'book', equityPercentage: 35, tenure: 6 },
  });
  expect(m.perform.mock.calls.map((call) => call[5].command.action)).toEqual([
    'book',
    'refresh_details',
  ]);
});
it('resumes a queued booking even when its terms match a cached plan', async () => {
  const durableKey = '80000000-0000-4000-8000-000000000001';
  m.read.mockResolvedValue({
    ...snapshot,
    state: { ...state, booking: { ...booking, loan_tenure: 3 } },
    pending: { action: 'book', status: 'queued', idempotencyKey: durableKey },
  });
  await quoteOxygenPlan(user, connection, {
    ...input,
    idempotencyKey: durableKey,
  });
  expect(m.perform.mock.calls.map((call) => call[5].command.action)).toEqual([
    'book',
    'refresh_details',
  ]);
  expect(m.perform.mock.calls[0][5].idempotencyKey).toBe(durableKey);
});
it('does not resume a queued booking using an unrelated retry key', async () => {
  const durableKey = '80000000-0000-4000-8000-000000000001';
  m.read.mockResolvedValue({
    ...snapshot,
    state: { ...state, booking: { ...booking, loan_tenure: 3 } },
    pending: { action: 'book', status: 'queued', idempotencyKey: durableKey },
  });
  rpc.mockResolvedValueOnce({
    data: { plans: [], selectedReference: null },
    error: null,
  });
  await expect(quoteOxygenPlan(user, connection, input)).rejects.toThrow(
    'blocked'
  );
  expect(m.perform).not.toHaveBeenCalled();
});
it.each([
  'executing',
  'indeterminate',
])('does not return a cached plan while a %s booking is unresolved', async (status) => {
  m.read.mockResolvedValue({
    ...snapshot,
    pending: { action: 'book', status, idempotencyKey: id },
  });
  await expect(quoteOxygenPlan(user, connection, input)).rejects.toThrow(
    'blocked'
  );
  expect(m.perform).not.toHaveBeenCalled();
});
it.each([
  'executing',
  'indeterminate',
])('never resumes a %s booking', async (status) => {
  m.read.mockResolvedValue({
    ...snapshot,
    pending: { action: 'book', status, idempotencyKey: id },
  });
  rpc.mockResolvedValue({
    data: { plans: [], selectedReference: null },
    error: null,
  });
  await expect(quoteOxygenPlan(user, connection, input)).rejects.toThrow(
    'blocked'
  );
  expect(m.perform).not.toHaveBeenCalled();
});
it('does not fetch details when a queued booking was claimed concurrently', async () => {
  const pending = { action: 'book', status: 'queued', idempotencyKey: id };
  m.read.mockResolvedValue({
    ...snapshot,
    state: { ...state, booking: { ...booking, loan_tenure: 3 } },
    pending,
  });
  rpc.mockResolvedValueOnce({
    data: { plans: [], selectedReference: null },
    error: null,
  });
  m.perform.mockResolvedValueOnce({
    ...snapshot,
    pending: { ...pending, status: 'executing' },
  });
  await expect(quoteOxygenPlan(user, connection, input)).rejects.toThrow(
    'blocked'
  );
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
  const metadata = vi.fn().mockReturnValue({ operation: 'details' });
  const bind = vi.fn().mockReturnValue({
    call,
    environment: 'production',
    responseMetadata: metadata,
  });
  m.perform.mockImplementationOnce(async (...args) => {
    expect(args[2].environment).toBe('production');
    expect(args[2].responseMetadata()).toEqual({ operation: 'details' });
    const bound = args[2].forCommand(user, id, ref);
    expect(bound.environment).toBe('production');
    expect(bound.responseMetadata()).toEqual({ operation: 'details' });
    await bound.call('details', {});
    expect(() => bound.call('approve', {})).toThrow('blocked');
    return snapshot;
  });
  await quoteOxygenPlan(
    user,
    {
      ...connection,
      provider: {
        call,
        environment: 'production',
        forCommand: bind,
        responseMetadata: metadata,
      },
    },
    input
  );
  expect(bind).toHaveBeenCalledWith(user, id, ref);
  expect(call).toHaveBeenCalledExactlyOnceWith('details', {});
});
