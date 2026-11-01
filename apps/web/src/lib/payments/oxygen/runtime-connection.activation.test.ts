import { afterEach, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  recover: vi.fn(),
  general: vi.fn(),
  trial: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('@/env', () => ({
  getSupabaseUrl: () => 'https://db.example.test',
  getSupabaseAnonKey: () => 'public-test-key',
}));
vi.mock('./callback-payment-recovery', () => ({
  reconcileOxygenCallbackPayment: m.recover,
}));
vi.mock('./general-activation', () => ({
  runGeneralOxygenActivation: m.general,
}));
vi.mock('./paid-activation', () => ({ completeOxygenPaidActivation: m.trial }));

import { connectOxygenRuntime } from './runtime-connection';

const workflow = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const worker = { rpc: vi.fn() };
function configure(environment: 'production' | 'staging') {
  vi.stubEnv(
    'VERCEL_ENV',
    environment === 'production' ? 'production' : 'preview'
  );
  const prefix = `OXYGEN_${environment.toUpperCase()}`;
  for (const [suffix, value] of Object.entries({
    RUNTIME_ENABLED: 'true',
    PARTNER_REFERENCE: 'synthetic-partner',
    PARTNER_SECRET: 'synthetic-secret',
    WORKER_EMAIL: 'worker@example.test',
    WORKER_PASSWORD: 'synthetic-password',
    HOSTED_HOSTS: 'hosted.example.test',
    DRAFT_ENCRYPTION_KEY: 'a'.repeat(64),
  }))
    vi.stubEnv(`${prefix}_${suffix}`, value);
  vi.stubEnv('OXYGEN_DRAFT_ENCRYPTION_KEY', 'b'.repeat(64));
  worker.rpc.mockResolvedValue({
    error: null,
    data: {
      environment,
      stage: 'payment_required',
      state: { paymentComplete: true, setupComplete: true },
    },
  });
  const runtime = connectOxygenRuntime();
  if (!runtime) throw new Error('Missing synthetic runtime');
  return runtime;
}
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetAllMocks();
});
it('defers an incomplete payment callback without activation', async () => {
  const runtime = configure('production');
  m.recover.mockResolvedValue(false);
  await expect(
    runtime.reconcilePaymentCallback(worker, workflow, workflow, workflow)
  ).rejects.toThrow('Payment remains unconfirmed');
  expect(m.general).not.toHaveBeenCalled();
  expect(m.trial).not.toHaveBeenCalled();
});
it('keeps a paid callback pending when automatic activation is disabled', async () => {
  const runtime = configure('production');
  m.recover.mockResolvedValue(true);
  await expect(
    runtime.reconcilePaymentCallback(worker, workflow, workflow, workflow)
  ).rejects.toThrow('Activation pending');
  expect(m.general).not.toHaveBeenCalled();
  expect(m.trial).not.toHaveBeenCalled();
});
it('completes an already activated callback without payment or activation replay', async () => {
  const runtime = configure('production');
  worker.rpc.mockResolvedValue({
    error: null,
    data: {
      environment: 'production',
      stage: 'activated',
      state: { paymentComplete: true, setupComplete: true },
    },
  });
  await runtime.reconcilePaymentCallback(worker, workflow, workflow, workflow);
  expect(m.recover).not.toHaveBeenCalled();
  expect(m.general).not.toHaveBeenCalled();
});
it('passes explicit activation opt-in without making a provider request itself', async () => {
  vi.stubEnv('OXYGEN_PRODUCTION_AUTOMATIC_ACTIVATION_ENABLED', 'true');
  const runtime = configure('production');
  await runtime.completePaidActivation(worker, workflow);
  expect(m.general).toHaveBeenCalledWith(
    worker,
    workflow,
    'production',
    true,
    expect.any(Function),
    'a'.repeat(64)
  );
});
it('retains only explicitly bound staging trial recovery', async () => {
  const runtime = configure('staging');
  await runtime.completePaidActivation(
    worker,
    '1c0459fe-2d45-4d2c-b41a-0ac640ad9f89'
  );
  expect(m.trial).toHaveBeenCalledOnce();
  expect(m.general).not.toHaveBeenCalled();
  const production = configure('production');
  await expect(
    production.completePaidActivation(
      worker,
      '1c0459fe-2d45-4d2c-b41a-0ac640ad9f89'
    )
  ).rejects.toThrow('Activation unavailable');
});
