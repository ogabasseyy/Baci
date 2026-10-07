import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import test from 'node:test';
import { bootstrapContractDatabase } from './bootstrap.mjs';
import { CONTRACT_E2E } from './constants.mjs';
import { createSourceLoader } from './source-loader.mjs';

test('bootstrap reads actual migrations and refuses a deployed physical runtime pin', () => {
  const loader = createSourceLoader([
    CONTRACT_E2E.canonicalRoot,
    CONTRACT_E2E.receiverRoot,
  ]);
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
  const database = {
    sql: (query) =>
      query.includes('SELECT system_identifier')
        ? CONTRACT_E2E.runtimeStoragePin
        : '',
  };
  assert.throws(
    () => bootstrapContractDatabase(database, loader, payout),
    /Disposable storage guard rebinding refused/
  );
});
