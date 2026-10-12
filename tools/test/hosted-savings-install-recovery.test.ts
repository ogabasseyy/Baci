import assert from 'node:assert/strict';
import test from 'node:test';
import { planHostedSavingsInstallRecovery } from './hosted-savings-install-recovery';

function fixture() {
  const receipt = { version: 1, project: 'baci-isolated-savings', service: 'postgres', containerId: 'a'.repeat(64), imageId: `sha256:${'b'.repeat(64)}`, dockerSocket: '/var/run/docker.sock', postgresSocket: '/tmp', database: 'postgres', serverVersion: 170006, manifestSha256: 'c'.repeat(64), parentReviewed: true, maintenance: true, noApplicationActivity: true, noExternalCredentials: true };
  const failure = { status: 'failed', phase: 'migration', attemptedOrdinal: 1, completed: 0, claimed: true, resumeAllowed: false, containerId: receipt.containerId, imageId: receipt.imageId, manifestSha256: receipt.manifestSha256 };
  const metadata = { containerId: receipt.containerId, manifestSha256: receipt.manifestSha256, journalRows: 0, ledgerRows: 0, applicationRows: 0, maintenance: true, parentVerified: true, backupSha256: 'd'.repeat(64), backupVerified: true, retainOriginalVolumeAndManagedState: true };
  return { receipt, failure, metadata };
}

test('never authorizes destructive reset even for exact empty first-file failure and verified backup', () => {
  const {receipt, failure, metadata} = fixture();
  const result = planHostedSavingsInstallRecovery(receipt, failure, metadata);
  assert.equal(result.inPlaceResetAuthorized, false);
  assert.equal(result.executionAuthorized, false);
  assert.equal(result.resumeAllowed, false);
});

test('requires reviewed original and current identity evidence for a recreated container on the same cluster and volume', () => {
  const { receipt, failure, metadata } = fixture();
  receipt.containerId = '49f305061c71bd22eb5ea92bf302a5163b50831165e3ba37db36aee18b2353b3';
  metadata.containerId = receipt.containerId;
  assert.throws(() => planHostedSavingsInstallRecovery(receipt, failure, metadata), /lineage/);
  const lineage = {
    parentReviewed: true,
    priorContainerId: failure.containerId,
    currentContainerId: receipt.containerId,
    priorImageId: failure.imageId,
    currentImageId: receipt.imageId,
    priorSystemIdentifier: '7685172624138473505',
    currentSystemIdentifier: '7685172624138473505',
    priorVolumeIdentitySha256: 'e'.repeat(64),
    currentVolumeIdentitySha256: 'e'.repeat(64),
    priorIdentityEvidenceSha256: 'f'.repeat(64),
    currentIdentityEvidenceSha256: '1'.repeat(64),
  };
  const result = planHostedSavingsInstallRecovery(receipt, failure, { ...metadata, lineage });
  assert.equal(result.identityLineage, 'parent-attested-same-cluster-and-volume');
  assert.equal(result.originalContainerId, failure.containerId);
  assert.equal(result.currentContainerId, receipt.containerId);
  assert.equal(result.inPlaceResetAuthorized, false);
  for (const mismatch of [
    { currentSystemIdentifier: '7685172624138473506' },
    { currentVolumeIdentitySha256: '2'.repeat(64) },
    { priorContainerId: 'd1415' },
    { currentContainerId: '3'.repeat(64) },
    { priorImageId: `sha256:${'4'.repeat(64)}` },
    { parentReviewed: false },
    { priorIdentityEvidenceSha256: undefined },
  ]) assert.throws(() => planHostedSavingsInstallRecovery(receipt, failure, { ...metadata, lineage: { ...lineage, ...mismatch } }));
});

test('rejects wrong identity, later failure, data, journal, ledger and absent backup proof', () => {
  for (const key of ['journalRows', 'ledgerRows', 'applicationRows'] as const) {
    const {receipt, failure, metadata} = fixture();
    metadata[key] = 1;
    assert.throws(() => planHostedSavingsInstallRecovery(receipt, failure, metadata));
  }
  const {receipt, failure, metadata} = fixture();
  for (const changed of [{...failure, attemptedOrdinal: 2}, {...failure, completed: 1}, {...failure, containerId: 'f'.repeat(64)}])
    assert.throws(() => planHostedSavingsInstallRecovery(receipt, changed, metadata));
  assert.throws(() => planHostedSavingsInstallRecovery(receipt, failure, {...metadata, backupVerified: false}));
});
