import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createFixture, fundingLoader } from './fixtures.ts';

test('synthetic consent preserves the exact draft and rejects mismatched goals', async () => {
  const fixture = createFixture('green', false);
  const input = {
    goalId: fixture.draft.goalId,
    revisionId: fixture.draft.revisionId,
    termsHash: fixture.draft.terms.hash,
    termsVersion: fixture.draft.terms.version,
    accepted: true as const,
    durationMonths: 1,
  };
  assert.deepEqual(await fixture.submit(input), {
    ...fixture.draft,
    consent: 'accepted',
  });
  await assert.rejects(fixture.submit({ ...input, goalId: 'wrong' }));
  await assert.rejects(fixture.submit({ ...input, durationMonths: 2 }));
  assert.equal(fixture.draft.durationMonths, 1);
  assert.notEqual(
    createFixture('blue', false).draft.device.variant,
    fixture.draft.device.variant
  );
});
test('funding has only non-bank synthetic placeholders and aborts locally', async () => {
  const controller = new AbortController();
  const load = fundingLoader('ready');
  assert.deepEqual(await load('synthetic', controller.signal), {
    status: 'ready',
    accounts: [
      {
        accountNumber: 'NOT-A-BANK-ACCOUNT',
        accountName: 'SYNTHETIC QA ONLY',
        bankName: 'NO REAL BANK — TEST FIXTURE',
      },
    ],
  });
  controller.abort();
  await assert.rejects(load('synthetic', controller.signal));
});
