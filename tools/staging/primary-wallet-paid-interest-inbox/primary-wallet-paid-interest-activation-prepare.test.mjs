import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { verifyPrimaryInterestPreparation } from './primary-wallet-paid-interest-activation-guard.mjs';
import { preparePrimaryInterestActivation } from './primary-wallet-paid-interest-activation-prepare.mjs';

const now = Date.parse('2026-10-07T21:00:00Z');
const hostInventory = {
  evidenceSource: 'authorized_host_metadata',
  host: 'bassey@82.29.190.219',
  capturedAt: new Date(now).toISOString(),
  nodeMajor: 24,
  accountPresent: false,
  paths: {},
  units: {},
  databaseInspected: false,
  configurationValuesInspected: false,
  activationAuthorized: false,
};

async function fixture(run) {
  const parent = await mkdtemp(
    path.join(os.tmpdir(), 'baci-interest-activation-test.')
  );
  try {
    const options = {
      outputDirectory: path.join(parent, 'package'),
      hostInventory,
      expiresAt: new Date(now + 3600000).toISOString(),
      now: () => now,
    };
    await run(options, parent);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
}

test('seals concrete interest-only artifacts with missing evidence blocked and no activation authorization', async () =>
  fixture(async (options) => {
    const prepared = await preparePrimaryInterestActivation(options);
    assert.equal(prepared.activationAuthorized, false);
    assert.equal(prepared.operatorEvidenceReviewed, false);
    const checked = await verifyPrimaryInterestPreparation(prepared.directory, {
      now: () => now,
    });
    assert.equal(checked.sealSha256, prepared.sealSha256);
    assert.equal(checked.activationAuthorized, false);
    const actions = JSON.parse(
      await readFile(
        path.join(prepared.directory, 'owner-actions.review.json'),
        'utf8'
      )
    );
    const monitoring = JSON.parse(
      await readFile(
        path.join(prepared.directory, 'monitoring-plan.review.json'),
        'utf8'
      )
    );
    assert.equal(actions.identity.dbLogin, 'baci_piggyvest_primary_evidence');
    assert.equal(actions.requiresOwnerApproval, true);
    assert.equal(monitoring.activationAuthorized, false);
    assert.equal(monitoring.alertDelivery.destination, null);
    assert.equal(
      monitoring.proposedDatabaseBoundary.role,
      'piggyvest_primary_interest_monitor'
    );
    assert.match(
      monitoring.proposedDatabaseBoundary.provisioning,
      /Not implemented/
    );
    assert.deepEqual(monitoring.suppliedHostInventory, {
      evidenceSource: hostInventory.evidenceSource,
      classification:
        'supplied_host_metadata_only_not_database_or_configuration_verification',
      host: hostInventory.host,
      capturedAt: hostInventory.capturedAt,
      workerAccountPresent: hostInventory.accountPresent,
      service: { LoadState: 'unknown' },
      timer: { LoadState: 'unknown' },
    });
    const sealEntries = (
      await readFile(path.join(prepared.directory, 'SHA256SUMS'), 'utf8')
    )
      .trim()
      .split('\n');
    const monitoringFile = await readFile(
      path.join(prepared.directory, 'monitoring-plan.review.json')
    );
    assert.ok(
      sealEntries.includes(
        `${createHash('sha256').update(monitoringFile).digest('hex')}  monitoring-plan.review.json`
      )
    );
    assert.match(
      actions.rollbackArtifactPolicy,
      /No blind deletion, inbox purge, role revocation/
    );
    const expiry = await readFile(
      path.join(prepared.directory, 'worker-expiry.conf'),
      'utf8'
    );
    assert.match(expiry, /--owner-gate/);
    assert.match(expiry, /--readiness/);
    const environment = await readFile(
      path.join(prepared.directory, 'runtime.env.example'),
      'utf8'
    );
    assert.match(
      environment,
      /PIGGYVEST_PRIMARY_EVIDENCE_DB_PASSWORD=OWNER_SECRET_OR_VERIFIED_SCOPE_REQUIRED/
    );
    assert.doesNotMatch(
      environment,
      /SUPABASE_SERVICE_ROLE|test-only-provider-token/
    );
    await assert.rejects(
      verifyPrimaryInterestPreparation(prepared.directory, {
        now: () => now,
        requireOwnerApproval: true,
      })
    );
  }));
test('rejects changed worker bytes and expired preparation before any owner gate', async () =>
  fixture(async (options) => {
    const prepared = await preparePrimaryInterestActivation(options);
    await assert.rejects(
      verifyPrimaryInterestPreparation(prepared.directory, {
        now: () => now + 3600000,
      }),
      /expired/
    );
    await writeFile(
      path.join(prepared.directory, 'interest-inbox.cjs'),
      'changed'
    );
    await assert.rejects(
      verifyPrimaryInterestPreparation(prepared.directory, { now: () => now }),
      /artifact changed/
    );
  }));
test('requires the monitoring plan file and its exact sealed bytes', async () =>
  fixture(async (options) => {
    const prepared = await preparePrimaryInterestActivation(options);
    const monitoringPath = path.join(
      prepared.directory,
      'monitoring-plan.review.json'
    );
    const sealPath = path.join(prepared.directory, 'SHA256SUMS');
    const originalSeal = await readFile(sealPath, 'utf8');

    await rm(monitoringPath);
    await assert.rejects(
      verifyPrimaryInterestPreparation(prepared.directory, { now: () => now }),
      /ENOENT/
    );

    await writeFile(
      monitoringPath,
      JSON.stringify({ activationAuthorized: false })
    );
    await writeFile(
      sealPath,
      originalSeal
        .split('\n')
        .filter((entry) => !entry.endsWith('  monitoring-plan.review.json'))
        .join('\n')
    );
    await assert.rejects(
      verifyPrimaryInterestPreparation(prepared.directory, { now: () => now }),
      /Required sealed artifact missing/
    );

    await writeFile(sealPath, originalSeal);
    await writeFile(monitoringPath, '{"tampered":true}');
    await assert.rejects(
      verifyPrimaryInterestPreparation(prepared.directory, { now: () => now }),
      /artifact changed/
    );
  }));
test('rejects unexpected package files but permits owner approval metadata', async () =>
  fixture(async (options) => {
    const prepared = await preparePrimaryInterestActivation(options);
    await writeFile(path.join(prepared.directory, 'unexpected.txt'), 'extra');
    await assert.rejects(
      verifyPrimaryInterestPreparation(prepared.directory, { now: () => now }),
      /Unexpected preparation artifact/
    );

    await rm(path.join(prepared.directory, 'unexpected.txt'));
    await writeFile(
      path.join(prepared.directory, 'owner-approval.json'),
      JSON.stringify({ preparedSealSha256: prepared.sealSha256 })
    );
    const checked = await verifyPrimaryInterestPreparation(prepared.directory, {
      now: () => now,
    });
    assert.equal(checked.sealSha256, prepared.sealSha256);
  }));
test('rejects a sealed-asset symlink rather than trusting its target bytes', async () =>
  fixture(async (options, parent) => {
    const prepared = await preparePrimaryInterestActivation(options);
    const filename = path.join(prepared.directory, 'runtime.env.example');
    const outside = path.join(parent, 'outside');
    await writeFile(outside, await readFile(filename));
    await rm(filename);
    await symlink(outside, filename);
    await assert.rejects(
      verifyPrimaryInterestPreparation(prepared.directory, { now: () => now }),
      /artifact changed/
    );
  }));
test('rejects stale/foreign host inventory and overlong expiry without packaging', async () =>
  fixture(async (options) => {
    for (const changed of [
      { hostInventory: { ...hostInventory, host: 'unknown-host' } },
      {
        hostInventory: {
          ...hostInventory,
          capturedAt: new Date(now - 3600001).toISOString(),
        },
      },
      { expiresAt: new Date(now + 86400001).toISOString() },
    ])
      await assert.rejects(
        preparePrimaryInterestActivation({ ...options, ...changed })
      );
  }));
test('does not turn guessed operator proof or secret-bearing DB metadata into authority', async () =>
  fixture(async (options) => {
    await assert.rejects(
      preparePrimaryInterestActivation({
        ...options,
        databaseInventory: { password: 'test-only-secret' },
      }),
      /Unsafe database inventory/
    );
  }));
test('does not accept approval assertions without matching actual database evidence', async () =>
  fixture(async (options) => {
    const proof = {
      kind: 'operator_inventory',
      capturedAt: new Date(now).toISOString(),
      expiresAt: options.expiresAt,
      hostInventorySha256: 'a'.repeat(64),
      databaseInventorySha256: 'b'.repeat(64),
      candidateBundleSha256: 'c'.repeat(64),
      providerContractProofSha256: 'd'.repeat(64),
      privilegedMigrationProofSha256: 'e'.repeat(64),
      exactProductionScopeVerified: true,
      restrictedCapabilitiesVerified: true,
      finiteCredentialExpiryVerified: true,
      rollbackReviewed: true,
    };
    await assert.rejects(
      preparePrimaryInterestActivation({ ...options, operatorProof: proof }),
      /does not match/
    );
  }));
