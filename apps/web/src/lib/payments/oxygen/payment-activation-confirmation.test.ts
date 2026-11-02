import { expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { confirmOxygenPaymentForActivation } from './payment-activation-confirmation';

const workflowId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const reference = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const snapshot = {
  workflowId,
  version: 3,
  state: {
    bookingReference: reference,
    paymentComplete: true,
    setupComplete: true,
  },
};
const confirmed = {
  reference,
  paymentComplete: true,
  setupComplete: true,
  checkedAt: '2026-11-01T10:00:00Z',
  lastOutcome: 'succeeded',
  pending: false,
  paymentUrl: null,
  setupUrl: null,
  resendBlocked: false,
} as const;
it('uses a fresh check_status with the exact workflow, booking and current version', async () => {
  const recover = vi.fn().mockResolvedValue(confirmed);
  expect(await confirmOxygenPaymentForActivation(snapshot, recover)).toBe(true);
  expect(recover).toHaveBeenCalledWith({
    workflowId,
    reference,
    version: 3,
    action: 'check_status',
    idempotencyKey: expect.any(String),
  });
});
it('does not read payment or activate when either prerequisite is incomplete', async () => {
  const recover = vi.fn();
  expect(
    await confirmOxygenPaymentForActivation(
      { ...snapshot, state: { ...snapshot.state, setupComplete: false } },
      recover
    )
  ).toBe(false);
  expect(recover).not.toHaveBeenCalled();
});
it.each([
  { ...confirmed, reference: workflowId },
  { ...confirmed, pending: true },
  { ...confirmed, paymentComplete: false },
  { ...confirmed, lastOutcome: 'failed' },
  { ...confirmed, checkedAt: null },
])('refuses an unbound or unconfirmed status', async (status) => {
  await expect(
    confirmOxygenPaymentForActivation(
      snapshot,
      vi.fn().mockResolvedValue(status)
    )
  ).resolves.toBe(false);
});
