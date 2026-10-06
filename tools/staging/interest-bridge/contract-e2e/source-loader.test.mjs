import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import test from 'node:test';
import { CONTRACT_E2E } from './constants.mjs';
import { createSourceLoader } from './source-loader.mjs';

test('loads real signature contract without dotenv or runtime entrypoints', () => {
  const loader = createSourceLoader([CONTRACT_E2E.canonicalRoot]);
  const contract = loader.load(
    resolve(
      CONTRACT_E2E.canonicalRoot,
      'apps/web/src/lib/piggyvest/verify-piggyvest-payload-signature.ts'
    )
  );
  assert.equal(
    contract.verifyPiggyvestPayloadSignature({
      payload: Buffer.from('{}'),
      signature: null,
      secret: CONTRACT_E2E.signingSecret,
    }),
    false
  );
  assert.equal(loader.manifest().sourceCount, 1);
  assert.match(loader.manifest().sha256, /^[a-f0-9]{64}$/);
});

test('refuses a source file outside the explicitly approved worktrees', () => {
  const loader = createSourceLoader([CONTRACT_E2E.canonicalRoot]);
  assert.throws(
    () => loader.track('/etc/hosts'),
    /Source outside approved worktrees/
  );
});
