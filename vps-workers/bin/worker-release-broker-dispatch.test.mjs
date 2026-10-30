import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const script = fileURLToPath(new URL('./worker-release-broker-dispatch.mjs', import.meta.url));

test('dispatcher fails closed without peer identity supplied by the kernel wrapper', () => {
  const result = spawnSync(process.execPath, [script], {
    input: '{"operation":"stage"}\n', encoding: 'utf8',
    env: { PATH: process.env.PATH ?? '/usr/bin:/bin' },
  });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, '');
});

test('dispatcher does not accept a client-forged peer identity in the JSON request', () => {
  const result = spawnSync(process.execPath, [script], {
    input: '{"operation":"stage","peerUid":0,"verifiedJob":{"sha":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}}\n',
    encoding: 'utf8',
    env: { PATH: process.env.PATH ?? '/usr/bin:/bin', BACI_BROKER_PEER_UID: '2001',
      BACI_BROKER_RELEASE_UID: '2001', BACI_BROKER_WORKER_UID: '2002' },
  });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, '');
});

test('dispatcher allowlists GIGL smoke metadata and never serializes the local fingerprint', () => {
  const source = readFileSync(script, 'utf8');
  assert.match(source, /result\.operation === 'gigl-capability'/);
  for (const field of ['smokePassed', 'latched', 'scope', 'installedSha', 'latchedSha']) {
    assert.match(source, new RegExp(`${field}: result\\.${field}`));
  }
  assert.doesNotMatch(source, /credentialFingerprint/);
});
