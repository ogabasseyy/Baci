import { expect, it } from 'vitest';
import type { OxygenRuntimeSnapshot } from '@/schemas/oxygen-runtime-view';
import { mayRetryFailedSelfie } from './oxygen-failed-selfie-retry';

const previous = {
  workflowId: '60000000-0000-4000-8000-000000000001',
  version: 1,
  stage: 'kyc_required',
  executionEnabled: true,
  state: {
    validated: true,
    applicationReference: '60000000-0000-4000-8000-000000000002',
    kyc: { selfie_status: 'NOT_DONE' },
  },
} as OxygenRuntimeSnapshot;
const current = { ...previous, version: 2 };

it('allows a customer retry only after a fresh, completed failure is observed', () => {
  expect(mayRetryFailedSelfie(previous, current)).toBe(true);
  expect(mayRetryFailedSelfie(previous, null)).toBe(false);
  expect(mayRetryFailedSelfie(previous, previous)).toBe(false);
  expect(
    mayRetryFailedSelfie(previous, { ...current, workflowId: 'another' })
  ).toBe(false);
  expect(
    mayRetryFailedSelfie(previous, {
      ...current,
      stage: 'reconciliation_required',
    })
  ).toBe(false);
  expect(
    mayRetryFailedSelfie(previous, {
      ...current,
      pending: {
        action: 'selfie_link',
        status: 'executing',
        idempotencyKey: previous.workflowId,
      },
    })
  ).toBe(false);
  expect(
    mayRetryFailedSelfie(previous, {
      ...current,
      state: { ...current.state, selfieUrl: 'https://example.test/selfie' },
    })
  ).toBe(false);
});
