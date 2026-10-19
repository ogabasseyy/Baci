import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DISPATCH_DISCOVERY_ATTEMPTS,
  findProductionDispatchRun,
} from './release-production.mjs';

// Split from release-production.test.mjs to keep both suites under
// the 300-line limit.
test('dispatch discovery polls page one, then confirms with one full scan', async () => {
  const commit = 'b'.repeat(40);
  const run = { databaseId: 42, event: 'workflow_dispatch', title: 'Coordinated release id', headSha: commit };
  let pages = 0;
  let fulls = 0;
  let sleeps = 0;
  const found = await findProductionDispatchRun(
    () => { pages++; return pages < 3 ? [] : [run]; },
    () => { fulls++; return [run]; },
    [],
    'id',
    commit,
    async () => { sleeps++; }
  );
  assert.equal(found, run);
  assert.equal(pages, 3);
  assert.equal(fulls, 1);
  assert.equal(sleeps, 2);
});

test('dispatch discovery gives up unknown after the full attempt budget', async () => {
  let pages = 0;
  let fulls = 0;
  const error = await findProductionDispatchRun(() => { pages++; return []; }, () => { fulls++; return []; }, [], 'id', 'b'.repeat(40), async () => {}).then(
    () => { throw new Error('expected rejection'); },
    rejection => rejection
  );
  assert.match(error.message, /dispatch outcome unknown/);
  assert.equal(error.indeterminateDispatch, true);
  assert.equal(pages, DISPATCH_DISCOVERY_ATTEMPTS);
  assert.equal(fulls, 0);
});

test('dispatch discovery fails fast on ambiguity without sleeping', async () => {
  const commit = 'b'.repeat(40);
  const run = { databaseId: 42, event: 'workflow_dispatch', title: 'Coordinated release id', headSha: commit };
  let sleeps = 0;
  await assert.rejects(
    findProductionDispatchRun(() => [run, { ...run, databaseId: 43 }], () => [], [], 'id', commit, async () => { sleeps++; }),
    /ambiguous/
  );
  assert.equal(sleeps, 0);
});
