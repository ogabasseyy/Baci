import { expect, it, vi } from 'vitest';

const dispatch = vi.hoisted(() => vi.fn());
vi.mock('server-only', () => ({}));
vi.mock('@/app/api/webhooks/piggyvest/primary-webhook-dispatch', () => ({
  dispatchPrimaryPiggyvestIntake: dispatch,
  isKillSwitchDeferral: () => false,
}));

import { paidInterestFixture } from './primary-wallet-paid-interest.test-support';
import type { ReplayDelivery } from './webhook-capture-drain';
import { replayPrimaryDelivery } from './webhook-capture-primary-replay';

it('passes its supplied environment through replay dispatch unchanged', async () => {
  dispatch.mockResolvedValue(new Response('{}', { status: 200 }));
  const env: NodeJS.ProcessEnv = {
    NODE_ENV: 'test',
    PIGGYVEST_KILL_SWITCH: 'false',
  };
  const delivery: ReplayDelivery = {
    rawBody: Buffer.from(JSON.stringify(paidInterestFixture.event)),
    signature: 'signature',
    matchedSecret: 'secret',
    families: ['interest'],
    recordedFamilies: ['interest'],
    incompleteKeySet: false,
    keyScope: 'replay',
  };

  await replayPrimaryDelivery(delivery, env);

  expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ env }));
});
