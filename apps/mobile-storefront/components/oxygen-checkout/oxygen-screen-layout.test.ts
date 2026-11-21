import type { OxygenRuntimeSnapshot } from '@baci/shared/oxygen';
import { oxygenShowsInlineRecovery } from './oxygen-screen-layout';

it.each([
  'booked',
  'payment_required',
  'ready_for_activation',
] as const)('leaves recovery to the %s screen instead of adding a duplicate action', (stage) => {
  const snapshot = { stage, state: {}, pending: null } as OxygenRuntimeSnapshot;
  expect(oxygenShowsInlineRecovery(snapshot)).toBe(false);
});

it('does not duplicate pending-address recovery or approval controls', () => {
  expect(
    oxygenShowsInlineRecovery({
      stage: 'reconciliation_required',
      pending: { action: 'submit_address', status: 'indeterminate' },
      state: {},
    } as OxygenRuntimeSnapshot)
  ).toBe(false);
  expect(
    oxygenShowsInlineRecovery({
      stage: 'approval_required',
      state: {},
    } as OxygenRuntimeSnapshot)
  ).toBe(false);
});
