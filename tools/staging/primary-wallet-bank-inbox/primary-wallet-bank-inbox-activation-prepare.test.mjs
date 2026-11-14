import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
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

test('accepts the exact bank worker capability and rejects grant drift', async () => fixture(async (options, parent) => {
  const baseline = await preparePrimaryBankActivation(options);
  const manifest = JSON.parse(await readFile(path.join(baseline.directory, 'manifest.json'), 'utf8'));
  const databaseInventory = {
    restricted_inventory: {
      captured_at: new Date(now).toISOString(),
      session_is_fixed_login: true, tls: true, login_restricted: true,
      login_valid_until: options.expiresAt, sole_capability_membership: true,
      capability_restricted: true, capability_parent_memberships: 1,
      readiness_reader_restricted: true, schema_usage: true,
      direct_private_table_privileges: 0, public_bank_rpcs: 0,
      bank_rpcs_present: true, customer_or_service_bank_execution: 0,
      effective_primary_rpcs: [
        'bank_inbox_readiness(p_integration uuid, p_environment text, p_scope jsonb)',
        'bank_role_safe(p_worker boolean)',
        'claim_bank_inbox(p_integration uuid, p_environment text, p_scope jsonb, p_command jsonb)',
        'engine_ready(p_surface text)',
        'process_bank_inbox(p_integration uuid, p_environment text, p_scope jsonb, p_command jsonb)',
        'retry_bank_inbox(p_integration uuid, p_environment text, p_scope jsonb, p_command jsonb)',
      ],
    },
    authority_inventory: { exact_enabled_authority_ready: true, financial_actions: false },
  };
  const sha = (value) => createHash('sha256').update(value).digest('hex');
  const prepare = (name, database) => preparePrimaryBankActivation({
    ...options,
    outputDirectory: path.join(parent, name),
    databaseInventory: database,
    operatorProof: {
      kind: 'operator_inventory', capturedAt: new Date(now).toISOString(), expiresAt: options.expiresAt,
      hostInventorySha256: sha(JSON.stringify(hostInventory, null, 2) + '\n'),
      databaseInventorySha256: sha(JSON.stringify(database, null, 2) + '\n'),
      candidateBundleSha256: manifest.artifacts['bank-inbox.cjs'],
      providerContractProofSha256: 'a'.repeat(64), privilegedMigrationProofSha256: 'b'.repeat(64),
      exactProductionScopeVerified: true, restrictedCapabilitiesVerified: true,
      finiteCredentialExpiryVerified: true, rollbackReviewed: true,
    },
  });
  const prepared = await prepare('exact', databaseInventory);
  assert.equal(prepared.operatorEvidenceReviewed, true);
  assert.equal(prepared.activationAuthorized, false);
  for (const [name, change] of [
    ['other-parent', (db) => { db.readiness_reader_restricted = false; }],
    ['no-parent', (db) => { db.capability_parent_memberships = 0; }],
    ['multiple-parents', (db) => { db.capability_parent_memberships = 2; }],
    ['duplicate-rpc', (db) => { db.effective_primary_rpcs[1] = db.effective_primary_rpcs[0]; }],
    ['missing-rpc', (db) => { db.effective_primary_rpcs.pop(); }],
    ['overload', (db) => { db.effective_primary_rpcs[0] = 'bank_inbox_readiness(p_scope jsonb)'; }],
    ['extra-rpc', (db) => { db.effective_primary_rpcs.push('unexpected()'); }],
  ]) {
    const database = structuredClone(databaseInventory);
    change(database.restricted_inventory);
    await assert.rejects(prepare(name, database), /Operator proof does not match/);
  }
}));
