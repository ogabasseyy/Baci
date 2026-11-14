import { afterEach, beforeEach, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const oxygenActivationTrialWorkflow = '52ab6696-762b-4e9f-8f99-a9d926a29b2c';

import { completeOxygenPaidActivation } from './paid-activation';

beforeEach(() => {
  vi.stubEnv('VERCEL_ENV', 'preview');
  vi.stubEnv(
    'OXYGEN_STAGING_ACTIVATION_TRIAL_BINDINGS',
    JSON.stringify([
      {
        reference: 'b75cd437-28af-4008-a1af-7e6810282833',
        workflowId: oxygenActivationTrialWorkflow,
      },
    ])
  );
});
afterEach(() => vi.unstubAllEnvs());

it('does not read or activate a trial when bindings are absent or production is selected', async () => {
  const rpc = vi.fn();
  const request = vi.fn();
  vi.stubEnv('OXYGEN_STAGING_ACTIVATION_TRIAL_BINDINGS', '');
  await completeOxygenPaidActivation(
    { rpc },
    oxygenActivationTrialWorkflow,
    request,
    'a'.repeat(64)
  );
  vi.stubEnv(
    'OXYGEN_STAGING_ACTIVATION_TRIAL_BINDINGS',
    JSON.stringify([
      {
        reference: 'b75cd437-28af-4008-a1af-7e6810282833',
        workflowId: oxygenActivationTrialWorkflow,
      },
    ])
  );
  vi.stubEnv('VERCEL_ENV', 'production');
  await completeOxygenPaidActivation(
    { rpc },
    oxygenActivationTrialWorkflow,
    request,
    'a'.repeat(64)
  );
  expect(rpc).not.toHaveBeenCalled();
  expect(request).not.toHaveBeenCalled();
});

it.each([
  'activated',
  'indeterminate',
  'executing',
  'rejected',
])('does not replay %s activation after another payment event', async (status) => {
  const rpc = vi.fn().mockResolvedValue({
    error: null,
    data: { status, result: {}, orderConfirmed: status === 'activated' },
  });
  const request = vi.fn();
  await completeOxygenPaidActivation(
    { rpc },
    oxygenActivationTrialWorkflow,
    request,
    'a'.repeat(64)
  );
  expect(request).not.toHaveBeenCalled();
  expect(rpc).toHaveBeenCalledTimes(1);
});
it('ignores older applications without even reading their trial', async () => {
  const rpc = vi.fn();
  const request = vi.fn();
  await completeOxygenPaidActivation(
    { rpc },
    'b1c11c04-ef5c-4519-963e-a5a9a8d2f951',
    request,
    'a'.repeat(64)
  );
  expect(rpc).not.toHaveBeenCalled();
  expect(request).not.toHaveBeenCalled();
});
it('requires a durable claim before any provider request', async () => {
  const rpc = vi.fn().mockImplementation(async (_name, args) => ({
    error: null,
    data:
      args.p_operation === 'status' ? { status: 'ready', result: {} } : null,
  }));
  const request = vi.fn();
  await completeOxygenPaidActivation(
    { rpc },
    oxygenActivationTrialWorkflow,
    request,
    'a'.repeat(64)
  );
  expect(request).not.toHaveBeenCalled();
});

it('reconciles an already-activated booking without sending activation again', async () => {
  const rpc = vi.fn().mockImplementation(async (name) => ({
    error: null,
    data:
      name === 'oxygen_reconcile_activation'
        ? { orderConfirmed: true }
        : { status: 'activated', orderConfirmed: false, result: {} },
  }));
  const request = vi.fn();
  await completeOxygenPaidActivation(
    { rpc },
    oxygenActivationTrialWorkflow,
    request,
    'a'.repeat(64)
  );
  expect(request).not.toHaveBeenCalled();
  expect(rpc).toHaveBeenCalledWith(
    'oxygen_reconcile_activation',
    expect.objectContaining({ p_workflow_id: oxygenActivationTrialWorkflow })
  );
});
