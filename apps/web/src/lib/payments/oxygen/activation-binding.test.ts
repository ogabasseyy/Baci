import { afterEach, beforeEach, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  oxygenActivationBinding,
  readOxygenActivationBindings,
} from './activation-binding';

const reference = '60000000-0000-4000-8000-000000000001';
const workflowId = '60000000-0000-4000-8000-000000000002';
beforeEach(() => {
  vi.stubEnv('VERCEL_ENV', 'preview');
  vi.stubEnv('OXYGEN_STAGING_ACTIVATION_TRIAL_BINDINGS', '');
});
afterEach(() => vi.unstubAllEnvs());
it('requires a valid explicit staging binding and fails closed on absent or invalid configuration', () => {
  expect(readOxygenActivationBindings()).toEqual([]);
  vi.stubEnv(
    'OXYGEN_STAGING_ACTIVATION_TRIAL_BINDINGS',
    JSON.stringify([{ reference, workflowId }])
  );
  expect(oxygenActivationBinding(reference)).toEqual({ reference, workflowId });
  expect(
    oxygenActivationBinding('70000000-0000-4000-8000-000000000001')
  ).toBeUndefined();
  for (const value of [
    'invalid',
    JSON.stringify([{ reference, workflowId: 'bad' }]),
    JSON.stringify([
      { reference, workflowId },
      { reference, workflowId },
    ]),
  ]) {
    vi.stubEnv('OXYGEN_STAGING_ACTIVATION_TRIAL_BINDINGS', value);
    expect(readOxygenActivationBindings()).toEqual([]);
  }
});
it('never enables configured trials in production', () => {
  vi.stubEnv(
    'OXYGEN_STAGING_ACTIVATION_TRIAL_BINDINGS',
    JSON.stringify([{ reference, workflowId }])
  );
  vi.stubEnv('VERCEL_ENV', 'production');
  expect(readOxygenActivationBindings()).toEqual([]);
  expect(oxygenActivationBinding(reference)).toBeUndefined();
  vi.stubEnv('VERCEL_ENV', '');
  vi.stubEnv('NODE_ENV', 'production');
  expect(readOxygenActivationBindings()).toEqual([]);
});
