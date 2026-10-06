import assert from 'node:assert/strict';
import test from 'node:test';
import { hostedSavingsInstallContract } from './hosted-savings-install-contract';

test('requires explicit reviewed owned receipt and rejects DSNs and remote Docker', () => {
  const receipt = {
    version: 1,
    project: 'baci-isolated-savings',
    service: 'postgres',
    containerId: 'a'.repeat(64),
    imageId: `sha256:${'b'.repeat(64)}`,
    dockerSocket: '/var/run/docker.sock',
    postgresSocket: '/tmp',
    database: 'postgres',
    serverVersion: 170006,
    manifestSha256: 'c'.repeat(64),
    parentReviewed: true,
    maintenance: true,
    noApplicationActivity: true,
    noExternalCredentials: true,
  };
  assert.equal(hostedSavingsInstallContract.safeParse(receipt).success, true);
  for (const patch of [
    { parentReviewed: false },
    { maintenance: false },
    { database: 'production' },
    { dockerSocket: 'ssh://vps' },
    { databaseUrl: 'postgres://remote/db' },
    { containerId: 'phone-stack' },
    { project: 'baci-production' },
  ])
    assert.equal(
      hostedSavingsInstallContract.safeParse({ ...receipt, ...patch }).success,
      false
    );
});
