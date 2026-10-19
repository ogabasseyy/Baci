import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import test from 'node:test';
import { CONTRACT_E2E } from './constants.mjs';
import { rebindDisposableRuntimeStorage } from './runtime-rebind.mjs';
import { createSourceLoader } from './source-loader.mjs';

test('changes only the runtime physical guard in an in-memory SQL copy', () => {
  const loader = createSourceLoader([CONTRACT_E2E.receiverRoot]);
  const source = loader
    .track(
      resolve(
        CONTRACT_E2E.receiverRoot,
        'apps/web/tools/piggyvest-staging/replay-runtime-storage.sql'
      )
    )
    .toString('utf8');
  const changed = rebindDisposableRuntimeStorage(source, '123456789');
  assert.equal(
    changed.replace('123456789', CONTRACT_E2E.runtimeStoragePin),
    source
  );
  for (const pin of [CONTRACT_E2E.runtimeStoragePin, '', 'remote-host'])
    assert.throws(() => rebindDisposableRuntimeStorage(source, pin));
  assert.throws(() =>
    rebindDisposableRuntimeStorage(`${source}${source}`, '1')
  );
});
