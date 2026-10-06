import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import test from 'node:test';
import { CONTRACT_E2E } from './constants.mjs';
import { createSourceLoader } from './source-loader.mjs';

test('real receiver replay refuses bad economics before executing a financial statement', async () => {
  const loader = createSourceLoader([
    CONTRACT_E2E.receiverRoot,
    CONTRACT_E2E.canonicalRoot,
  ]);
  const { createInterestReplay } = loader.load(
    resolve(
      CONTRACT_E2E.receiverRoot,
      'apps/web/tools/piggyvest-staging/replay-interest-runtime.ts'
    )
  );
  const payout = JSON.parse(
    loader
      .track(
        resolve(
          CONTRACT_E2E.canonicalRoot,
          'apps/web/src/schemas/piggyvest/interest-payout-success.fixture.json'
        )
      )
      .toString('utf8')
  );
  payout.eventData.break_down.withholding_tax = 82;
  let executed = false;
  const replay = createInterestReplay(
    {
      integrationId: CONTRACT_E2E.integrationId,
      businessId: CONTRACT_E2E.businessId,
      expectedSystemId: '123456789',
    },
    () => {
      executed = true;
      return Promise.resolve({ rows: [{ result: 'applied' }] });
    }
  );
  await assert.rejects(
    () => replay(payout),
    /Replay dispatch quarantined: conflict/
  );
  assert.equal(executed, false);
});
