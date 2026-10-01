import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { canonicalJson } from './task9-bootstrap.mjs';
import { checkedTask9Provenance } from './task9-bootstrap-provenance.mjs';

const hash = (value) => createHash('sha256').update(value).digest('hex');
const node = Buffer.from('node');
const policy = {
  supplyChain: {
    node: { ownerDarwinArm64Sha256: 'a'.repeat(64), version: '24.18.0' },
  },
  supplyChainProvenance: {
    node: {
      checksumsSha256: 'b'.repeat(64),
      keyringSha256: 'c'.repeat(64),
      signatureSha256: 'd'.repeat(64),
    },
  },
};
const provenance = {
  archiveSha256: 'a'.repeat(64),
  artifact: 'node',
  checksumSha256: 'b'.repeat(64),
  executableSha256: hash(node),
  keyringSha256: 'c'.repeat(64),
  schemaVersion: 1,
  sha256: hash(node),
  signatureSha256: 'd'.repeat(64),
  version: '24.18.0',
};

test('accepts only policy-bound executable provenance', () => {
  let called = false;
  const result = checkedTask9Provenance(
    Buffer.from(canonicalJson(provenance)),
    node,
    Buffer.from('archive'),
    policy,
    (value) => {
      called = true;
      assert.equal(value.nodeBytes, node);
    }
  );
  assert.deepEqual(result, provenance);
  assert.equal(called, true);
});

test('rejects executable or policy provenance drift', () => {
  for (const changed of [
    { ...provenance, executableSha256: 'e'.repeat(64) },
    { ...provenance, archiveSha256: 'f'.repeat(64) },
    { ...provenance, checksumSha256: 'e'.repeat(64) },
    { ...provenance, keyringSha256: 'e'.repeat(64) },
    { ...provenance, signatureSha256: 'e'.repeat(64) },
    { ...provenance, artifact: 'bun' },
    { ...provenance, schemaVersion: 2 },
    { ...provenance, extra: true },
  ])
    assert.throws(
      () =>
        checkedTask9Provenance(
          Buffer.from(canonicalJson(changed)),
          node,
          Buffer.from('archive'),
          policy,
          () => undefined
        ),
      /invalid Node provenance/
    );
  assert.throws(
    () =>
      checkedTask9Provenance(
        Buffer.from('{"artifact":"node"'),
        node,
        Buffer.from('archive'),
        policy,
        () => undefined
      ),
    /invalid Node provenance/
  );
  assert.throws(
    () =>
      checkedTask9Provenance(
        Buffer.from(canonicalJson(provenance)),
        node,
        Buffer.from('archive'),
        null,
        () => undefined
      ),
    /invalid Node provenance/
  );
  const reordered = Buffer.from(
    '{"version":"24.18.0","signatureSha256":"dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd","sha256":"' +
      hash(node) +
      '","schemaVersion":1,"keyringSha256":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","executableSha256":"' +
      hash(node) +
      '","checksumSha256":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","artifact":"node","archiveSha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}'
  );
  assert.throws(
    () =>
      checkedTask9Provenance(
        reordered,
        node,
        Buffer.from('archive'),
        policy,
        () => undefined
      ),
    /invalid Node provenance/
  );
});
