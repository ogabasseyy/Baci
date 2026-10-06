import assert from 'node:assert/strict';
import test from 'node:test';
import { parseHostedSavingsResetReview } from './hosted-savings-install-reset-contract';

function fixture() {
  const manifestSha256 = '0546896a24a17138b207da860d3b97d4baa35bdca4516645605043f12c1fb90f';
  const databaseArchive = { path: '/synthetic/database', bytes: 567963, sha256: '22ac05c4a15a319c75de4c563c432154f0e504d0b7625526c4542e326814afc5' };
  const currentReceipt = { version: 1, project: 'baci-isolated-savings', service: 'postgres', containerId: 'a'.repeat(64), imageId: `sha256:${'b'.repeat(64)}`, dockerSocket: '/var/run/docker.sock', postgresSocket: '/tmp', database: 'postgres', serverVersion: 170006, manifestSha256, parentReviewed: true, maintenance: true, noApplicationActivity: true, noExternalCredentials: true };
  return {
    version: 1, parentReviewedCurrentStateReset: true, databaseArchiveListVerified: true, globalsBackupVerified: true,
    currentReceipt,
    failedReceipt: { status: 'failed', phase: 'migration', attemptedOrdinal: 1, completed: 0, claimed: true, resumeAllowed: false, containerId: currentReceipt.containerId, imageId: currentReceipt.imageId, manifestSha256 },
    metadata: { containerId: currentReceipt.containerId, manifestSha256, journalRows: 0, ledgerRows: 0, applicationRows: 0, maintenance: true, parentVerified: true, backupSha256: databaseArchive.sha256, backupVerified: true, retainOriginalVolumeAndManagedState: true },
    systemIdentifier: '7685172624138473505', volumeIdentitySha256: 'e'.repeat(64), publicComment: null,
    databaseArchive, globalsArchive: { path: '/synthetic/globals', bytes: 4405, sha256: '19991c49b1337c0a2e0ada7f297f3f28470e21796f61d7cfe58cf120f31430fe' },
  };
}

test('accepts reviewed metadata without opening synthetic archive paths', () => {
  const result = parseHostedSavingsResetReview(fixture());
  assert.equal(result.databaseArchive.path, '/synthetic/database');
  assert.equal(result.publicComment, null);
});

test('rejects missing approvals, unknown fields and cluster identity changes', () => {
  for (const changed of [{ parentReviewedCurrentStateReset: false }, { databaseArchiveListVerified: false }, { globalsBackupVerified: false }, { extra: true }, { systemIdentifier: '1' }, { publicComment: 'x'.repeat(10001) }]) {
    assert.throws(() => parseHostedSavingsResetReview({ ...fixture(), ...changed }));
  }
});

test('rejects unbound backups, archive limits and nonempty replay evidence', () => {
  for (const key of ['databaseArchive', 'globalsArchive'] as const) {
    for (const changed of [{ bytes: 1 }, { bytes: 2_000_001 }, { sha256: '0'.repeat(64) }, { path: 'relative' }]) {
      const review = fixture();
      assert.throws(() => parseHostedSavingsResetReview({ ...review, [key]: { ...review[key], ...changed } }));
    }
  }
  for (const changed of [{ journalRows: 1 }, { ledgerRows: 1 }, { applicationRows: 1 }, { backupVerified: false }, { backupSha256: '0'.repeat(64) }]) {
    const review = fixture();
    assert.throws(() => parseHostedSavingsResetReview({ ...review, metadata: { ...review.metadata, ...changed } }));
  }
});

test('rejects later failure and a different consistently bound manifest', () => {
  const review = fixture();
  assert.throws(() => parseHostedSavingsResetReview({ ...review, failedReceipt: { ...review.failedReceipt, attemptedOrdinal: 2 } }));
  const manifestSha256 = 'f'.repeat(64);
  assert.throws(() => parseHostedSavingsResetReview({ ...review, currentReceipt: { ...review.currentReceipt, manifestSha256 }, failedReceipt: { ...review.failedReceipt, manifestSha256 }, metadata: { ...review.metadata, manifestSha256 } }), /Wrong reviewed bundle/);
});
