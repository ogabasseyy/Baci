import { expect, it, vi } from 'vitest';

const fetcher = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api-client', () => ({ fetchWithCsrf: fetcher }));

import {
  canReplaceQueuedAddress,
  retireQueuedAddress,
  selectOxygenActionKey,
} from './oxygen-address-recovery';

const snapshot = {
  workflowId: 'w',
  version: 1,
  stage: 'booked',
  state: {
    bookingReference: 'r',
    booking: { status: 'BOOKED' },
    kyc: { address_status: 'NOT_DONE' },
  },
  pending: {
    action: 'submit_address',
    status: 'queued',
    idempotencyKey: 'old',
  },
} as never;
it('requires a valid queued booking and produces a distinct replacement key', () => {
  expect(canReplaceQueuedAddress(snapshot)).toBe(true);
  expect(
    selectOxygenActionKey(
      'submit_address',
      snapshot,
      { action: 'submit_address', version: 1, key: 'old' },
      null
    )
  ).not.toBe('old');
});
it('does not retire without a newly selected file', async () => {
  await expect(
    retireQueuedAddress(snapshot, {
      action: 'submit_address',
      state: 'Lagos',
      lga: 'Ikeja',
      city: 'Ikeja',
      street: 'Road',
      landmark: 'Mall',
      house_number: '1',
    })
  ).rejects.toThrow('Unable to continue');
  expect(fetcher).not.toHaveBeenCalled();
});
