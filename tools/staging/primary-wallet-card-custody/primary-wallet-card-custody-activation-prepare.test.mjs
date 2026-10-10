import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { preparePrimaryCustodyActivation } from './primary-wallet-card-custody-activation-prepare.mjs';
import { verifyPrimaryCustodyPreparation } from './primary-wallet-card-custody-activation-guard.mjs';

const now = Date.parse('2026-10-07T21:00:00Z');
const hostInventory = { evidenceSource: 'authorized_host_metadata', host: 'bassey@82.29.190.219', instance: 'primary',
  capturedAt: new Date(now).toISOString(), nodeMajor: 24, accountPresent: false, paths: {}, units: {},
  databaseInspected: false, configurationValuesInspected: false, activationAuthorized: false };

async function fixture(run) {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'baci-custody-activation-test.'));
  try {
    const options = { outputDirectory: path.join(parent, 'package'), hostInventory, expiresAt: new Date(now+3600000).toISOString(), now: () => now };
    await run(options, parent);
  } finally { await rm(parent, { recursive: true, force: true }); }
}

test('seals concrete custody-only artifacts with missing evidence blocked and no activation authorization', async () => fixture(async (options) => {
  const prepared = await preparePrimaryCustodyActivation(options);
  assert.equal(prepared.activationAuthorized, false);
  assert.equal(prepared.operatorEvidenceReviewed, false);
  const checked = await verifyPrimaryCustodyPreparation(prepared.directory, { now: () => now });
  assert.equal(checked.sealSha256, prepared.sealSha256);
  assert.equal(checked.activationAuthorized, false);
  const actions = JSON.parse(await readFile(path.join(prepared.directory,'owner-actions.review.json'),'utf8'));
  assert.equal(actions.identity.dbLogin, 'baci_primary_card_custody');
  assert.equal(actions.requiresOwnerApproval, true);
  assert.equal(actions.instance, 'primary');
  assert.match(JSON.stringify(actions.install), /primary-card-custody-primary\.env/);
  assert.match(JSON.stringify(actions.install), /CROSSWALK_FILE/);
  assert.match(JSON.stringify(actions.ownerOnlySequence), /baci-primary-card-custody@primary\.timer/);
  assert.match(actions.rollbackArtifactPolicy, /No blind deletion, inbox purge, role revocation/);
  const expiry = await readFile(path.join(prepared.directory,'worker-expiry.conf'),'utf8');
  assert.match(expiry, /--owner-gate/);
  assert.match(expiry, /--readiness/);
  const environment = await readFile(path.join(prepared.directory,'runtime.env.example'),'utf8');
  assert.match(environment, /PIGGYVEST_PRIMARY_CARD_CUSTODY_PASSWORD=OWNER_SECRET_OR_VERIFIED_SCOPE_REQUIRED/);
  assert.match(environment, /PIGGYVEST_PRIMARY_CARD_CROSSWALK_DELIVERY_KEY=OWNER_SECRET_OR_VERIFIED_SCOPE_REQUIRED/);
  assert.doesNotMatch(environment, /TRANSFER_PASSWORD|INTAKE_PASSWORD|SUPABASE_SERVICE_ROLE|test-only-provider-token/);
  await assert.rejects(verifyPrimaryCustodyPreparation(prepared.directory, { now: () => now, requireOwnerApproval: true }));
}));
test('rejects changed worker bytes and expired preparation before any owner gate', async () => fixture(async (options) => {
  const prepared = await preparePrimaryCustodyActivation(options);
  await assert.rejects(verifyPrimaryCustodyPreparation(prepared.directory, { now: () => now+3600000 }), /expired/);
  await writeFile(path.join(prepared.directory,'custody.cjs'),'changed');
  await assert.rejects(verifyPrimaryCustodyPreparation(prepared.directory, { now: () => now }), /artifact changed/);
}));
test('rejects a sealed-asset symlink rather than trusting its target bytes', async () => fixture(async (options, parent) => {
  const prepared = await preparePrimaryCustodyActivation(options);
  const filename=path.join(prepared.directory,'runtime.env.example');
  const outside=path.join(parent,'outside');
  await writeFile(outside,await readFile(filename)); await rm(filename); await symlink(outside,filename);
  await assert.rejects(verifyPrimaryCustodyPreparation(prepared.directory, { now: () => now }), /artifact changed/);
}));
test('rejects stale/foreign host inventory, missing instance and overlong expiry without packaging', async () => fixture(async (options) => {
  for (const changed of [
    { hostInventory: { ...hostInventory, host: 'unknown-host' } },
    { hostInventory: { ...hostInventory, capturedAt: new Date(now-3600001).toISOString() } },
    { hostInventory: { ...hostInventory, instance: '../escape' } },
    { hostInventory: { ...hostInventory, instance: undefined } },
    { expiresAt: new Date(now+86400001).toISOString() },
  ]) await assert.rejects(preparePrimaryCustodyActivation({ ...options, ...changed }));
}));
test('does not turn guessed operator proof or secret-bearing DB metadata into authority', async () => fixture(async (options) => {
  await assert.rejects(preparePrimaryCustodyActivation({ ...options, databaseInventory: { password: 'test-only-secret' } }), /Unsafe database inventory/);
}));
test('does not accept approval assertions without matching actual database evidence', async () => fixture(async (options) => {
  const proof={ kind:'operator_inventory', capturedAt:new Date(now).toISOString(), expiresAt:options.expiresAt,
    hostInventorySha256:'a'.repeat(64), databaseInventorySha256:'b'.repeat(64),candidateBundleSha256:'c'.repeat(64),
    providerContractProofSha256:'d'.repeat(64),privilegedMigrationProofSha256:'e'.repeat(64),
    exactProductionScopeVerified:true,restrictedCapabilitiesVerified:true,finiteCredentialExpiryVerified:true,rollbackReviewed:true };
  await assert.rejects(preparePrimaryCustodyActivation({ ...options, operatorProof: proof }), /does not match/);
}));
