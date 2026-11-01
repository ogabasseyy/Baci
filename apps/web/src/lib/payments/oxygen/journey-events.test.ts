import { expect, it, vi } from 'vitest';

const capture = vi.hoisted(() => vi.fn());
vi.mock('@/lib/posthog/capture-client-event', () => ({
  captureClientEvent: capture,
}));

import { trackOxygenJourney } from './journey-events';

it('emits only correlation and enum fields, never command payloads or raw errors', () => {
  trackOxygenJourney(
    'action_unconfirmed',
    'order-1',
    'kyc_required',
    'validate_customer'
  );
  expect(capture).toHaveBeenLastCalledWith(
    'oxygen_application_action_unconfirmed',
    {
      order_id: 'order-1',
      provider: 'oxygen',
      stage: 'kyc_required',
      action: 'validate_customer',
    }
  );
  trackOxygenJourney('closed', 'order-1', 'bank');
  expect(capture).toHaveBeenLastCalledWith('oxygen_application_closed', {
    order_id: 'order-1',
    provider: 'oxygen',
    stage: 'bank',
  });
});
