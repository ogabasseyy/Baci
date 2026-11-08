import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { preparePrimaryBankActivation } from './primary-wallet-bank-inbox-activation-prepare.mjs';
import { verifyPrimaryBankPreparation } from './primary-wallet-bank-inbox-activation-guard.mjs';

const now = Date.parse('2026-10-07T21:00:00Z');
const hostInventory = { evidenceSource: 'authorized_host_metadata', host: 'bassey@82.29.190.219',
  capturedAt: new Date(now).toISOString(), nodeMajor: 24, accountPresent: false, paths: {}, units: {},
  databaseInspected: false, configurationValuesInspected: false, activationAuthorized: false };

async function fixture(run) {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'baci-bank-activation-test.'));
  try {
    const options = { outputDirectory: path.join(parent, 'package'), hostInventory, expiresAt: new Date(now+3600000).toISOString(), now: () => now };
    await run(options, parent);
  } finally { await rm(parent, { recursive: true, force: true }); }
}

test('seals concrete bank-only artifacts with missing evidence blocked and no activation authorization', async () => fixture(async (options) => {
  const prepared = await preparePrimaryBankActivation(options);
  assert.equal(prepared.activationAuthorized, false);
  assert.equal(prepared.operatorEvidenceReviewed, false);
  const checked = await verifyPrimaryBankPreparation(prepared.directory, { now: () => now });
  assert.equal(checked.sealSha256, prepared.sealSha256);
  assert.equal(checked.activationAuthorized, false);
  const actions = JSON.parse(await readFile(path.join(prepared.directory,'owner-actions.review.json'),'utf8'));
  assert.equal(actions.identity.dbLogin, 'baci_primary_bank_worker');
  assert.equal(actions.requiresOwnerApproval, true);
  assert.match(actions.rollbackArtifactPolicy, /No blind deletion, inbox purge, role revocation/);
  const expiry = await readFile(path.join(prepared.directory,'worker-expiry.conf'),'utf8');
  assert.match(expiry, /--owner-gate/);
  assert.match(expiry, /--readiness/);
  const environment = await readFile(path.join(prepared.directory,'runtime.env.example'),'utf8');
  assert.match(environment, /PIGGYVEST_PRIMARY_BANK_WORKER_PASSWORD=OWNER_SECRET_OR_VERIFIED_SCOPE_REQUIRED/);
  assert.doesNotMatch(environment, /SUPABASE_SERVICE_ROLE|test-only-provider-token/);
  await assert.rejects(verifyPrimaryBankPreparation(prepared.directory, { now: () => now, requireOwnerApproval: true }));
}));
test('rejects changed worker bytes and expired preparation before any owner gate', async () => fixture(async (options) => {
  const prepared = await preparePrimaryBankActivation(options);
  await assert.rejects(verifyPrimaryBankPreparation(prepared.directory, { now: () => now+3600000 }), /expired/);
  await writeFile(path.join(prepared.directory,'bank-inbox.cjs'),'changed');
  await assert.rejects(verifyPrimaryBankPreparation(prepared.directory, { now: () => now }), /artifact changed/);
}));
test('rejects a sealed-asset symlink rather than trusting its target bytes', async () => fixture(async (options, parent) => {
  const prepared = await preparePrimaryBankActivation(options);
  const filename=path.join(prepared.directory,'runtime.env.example');
  const outside=path.join(parent,'outside');
  await writeFile(outside,await readFile(filename)); await rm(filename); await symlink(outside,filename);
  await assert.rejects(verifyPrimaryBankPreparation(prepared.directory, { now: () => now }), /artifact changed/);
}));
test('rejects stale/foreign host inventory and overlong expiry without packaging', async () => fixture(async (options) => {
  for (const changed of [
    { hostInventory: { ...hostInventory, host: 'unknown-host' } },
    { hostInventory: { ...hostInventory, capturedAt: new Date(now-3600001).toISOString() } },
    { expiresAt: new Date(now+86400001).toISOString() },
  ]) await assert.rejects(preparePrimaryBankActivation({ ...options, ...changed }));
}));
test('does not turn guessed operator proof or secret-bearing DB metadata into authority', async () => fixture(async (options) => {
  await assert.rejects(preparePrimaryBankActivation({ ...options, databaseInventory: { password: 'test-only-secret' } }), /Unsafe database inventory/);
}));
test('does not accept approval assertions without matching actual database evidence', async () => fixture(async (options) => {
  const proof={ kind:'operator_inventory', capturedAt:new Date(now).toISOString(), expiresAt:options.expiresAt,
    hostInventorySha256:'a'.repeat(64), databaseInventorySha256:'b'.repeat(64),candidateBundleSha256:'c'.repeat(64),
    providerContractProofSha256:'d'.repeat(64),privilegedMigrationProofSha256:'e'.repeat(64),
    exactProductionScopeVerified:true,restrictedCapabilitiesVerified:true,finiteCredentialExpiryVerified:true,rollbackReviewed:true };
  await assert.rejects(preparePrimaryBankActivation({ ...options, operatorProof: proof }), /does not match/);
}));
