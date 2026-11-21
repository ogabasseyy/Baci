import { OxygenClientError } from './errors';
import { resendOxygenPhoneCode } from './resend-phone-code';
import type { OxygenWorkflowState } from './workflow-state';

const initial = {
  busy: false,
  error: null,
  capabilities: { mobileEnabled: true },
  snapshot: {
    workflowId: 'same',
    version: 1,
    state: { applicationReference: 'reference' },
  },
} as unknown as OxygenWorkflowState;
it('propagates expired sign-in instead of claiming a send or resetting expiry', async () => {
  let state = initial;
  const error = new OxygenClientError('auth');
  const execute = jest.fn(async () => {
    state = { ...initial, error };
  });
  await expect(
    resendOxygenPhoneCode({ getState: () => state, execute })
  ).rejects.toBe(error);
  expect(execute).toHaveBeenCalledTimes(1);
});
it('accepts only a fresh completed resend and does not dispatch while busy', async () => {
  let state = initial;
  const currentSnapshot = initial.snapshot;
  if (!currentSnapshot) throw new Error('Missing test snapshot');
  const execute = jest.fn(async () => {
    state = { ...initial, snapshot: { ...currentSnapshot, version: 2 } };
  });
  await expect(
    resendOxygenPhoneCode({ getState: () => state, execute })
  ).resolves.toBeUndefined();
  state = { ...initial, busy: true };
  await expect(
    resendOxygenPhoneCode({ getState: () => state, execute })
  ).rejects.toMatchObject({ code: 'busy' });
  expect(execute).toHaveBeenCalledTimes(1);
});
