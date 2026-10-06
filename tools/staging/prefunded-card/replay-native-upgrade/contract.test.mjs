import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { reviewOverlay } from './contract.mjs';
import { authority } from './constants.mjs';

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const frozenBytes = readFileSync(authority.frozenInventory);
const fixture = () => JSON.parse(frozenBytes);
function review(value, pin) {
  const bytes = Buffer.from(JSON.stringify(value));
  return reviewOverlay(bytes, pin ?? digest(bytes));
}

test('accepts exact frozen six-file productionDelta including INGEST and two absent files', () => {
  assert.equal(digest(frozenBytes), authority.frozenInventorySha256);
  const parsed = reviewOverlay(frozenBytes, authority.frozenInventorySha256);
  assert.deepEqual(parsed.files.map((row) => row.target), authority.requiredTargets);
  assert.deepEqual(parsed.files.filter((row) => row.canonicalSha256 === null).map((row) => row.target), authority.newTargets);
});

test('refuses unstable, unreviewed, missing and extra inventory fields', () => {
  for (const patch of [
    { status: 'draft' },
    { alias: 'not approved' },
    { receiverRoot: '/relative/../not-canonical' },
  ]) {
    assert.throws(() => review({ ...fixture(), ...patch }), /inventory/);
  }
  const changed = fixture();
  delete changed.status;
  assert.throws(() => review(changed), /inventory/);
});

test('refuses omission of any of six targets, duplicates and unauthorized replacements', () => {
  for (let index = 0; index < authority.requiredTargets.length; index += 1) {
    const missing = fixture();
    missing.productionDelta.splice(index, 1);
    assert.throws(() => review(missing), /patch targets/);
  }
  const duplicate = fixture();
  duplicate.productionDelta.push(duplicate.productionDelta[0]);
  assert.throws(() => review(duplicate), /patch targets/);
  const extra = fixture();
  extra.productionDelta[0].path = authority.receiverRoot + '/apps/web/src/proxy.ts';
  assert.throws(() => review(extra), /patch targets/);
});

test('refuses traversal, absolute receiver paths, changed bytes and invalid source pins', () => {
  for (const patch of [
    { path: authority.receiverRoot + '/../native.ts' },
    { path: '/root/native.ts' },
    { sha256: 'not a hash' },
    { canonicalImportSha256: null },
    { authority: 'guess' },
  ]) {
    const changed = fixture();
    changed.productionDelta[0] = { ...changed.productionDelta[0], ...patch };
    assert.throws(() => review(changed), /inventory/);
  }
  assert.throws(() => review(fixture(), '0'.repeat(64)), /reviewed inventory pin/);
});

test('rejects duplicate JSON keys instead of trusting JSON.parse last-write semantics', () => {
  const bytes = Buffer.from(JSON.stringify(fixture()).replace('"schemaVersion":1', '"schemaVersion":9,"schemaVersion":1'));
  assert.throws(() => reviewOverlay(bytes, digest(bytes)), /inventory JSON/);
});

test('only the exact two new files may have null canonical pins', () => {
  for (let index = 0; index < authority.requiredTargets.length; index += 1) {
    const changed = fixture();
    changed.productionDelta[index].canonicalImportSha256 = index < 4 ? null : 'a'.repeat(64);
    assert.throws(() => review(changed), /source pin/);
  }
});
