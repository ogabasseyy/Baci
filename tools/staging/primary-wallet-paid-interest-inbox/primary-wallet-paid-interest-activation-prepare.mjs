import { createHash } from 'node:crypto';
import { copyFile, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPrimaryPaidInterestInboxPackage } from './primary-wallet-paid-interest-inbox-package.mjs';

const directory = path.dirname(fileURLToPath(import.meta.url));
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const flags = ['VERCEL_ENV=production','PIGGYVEST_PRIMARY_ENVIRONMENT=production',
  'PIGGYVEST_PRIMARY_PAID_INTEREST_INBOX_ENABLED=true','PIGGYVEST_PRIMARY_PAID_INTEREST_ENABLED=true',
  'PIGGYVEST_PRIMARY_PAID_INTEREST_WORKER_APPROVED=true'];
const required = ['PIGGYVEST_PRIMARY_INTEGRATION_ID','PIGGYVEST_PRIMARY_PAID_INTEREST_BUSINESS_ID',
  'PIGGYVEST_PRIMARY_PAID_INTEREST_API_TOKEN','PIGGYVEST_PRIMARY_PAID_INTEREST_WEBHOOK_SECRET',
  'PIGGYVEST_PRIMARY_DB_HOST','PIGGYVEST_PRIMARY_DB_PORT','PIGGYVEST_PRIMARY_DB_NAME',
  'PIGGYVEST_PRIMARY_EVIDENCE_DB_PASSWORD','PIGGYVEST_PRIMARY_DB_CA'];

function inspectOperatorProof(proof, context) {
  if (!proof) return false;
  const allowed = ['kind','capturedAt','expiresAt','hostInventorySha256','databaseInventorySha256',
    'candidateBundleSha256','providerContractProofSha256','privilegedMigrationProofSha256',
    'exactProductionScopeVerified','restrictedCapabilitiesVerified','finiteCredentialExpiryVerified','rollbackReviewed'];
  if (Object.keys(proof).some((key) => !allowed.includes(key)) || proof.kind !== 'operator_inventory' ||
    proof.hostInventorySha256 !== context.inventoryDigest || proof.candidateBundleSha256 !== context.bundleDigest ||
    proof.databaseInventorySha256 !== context.databaseDigest || !context.databaseReady ||
    !['databaseInventorySha256','providerContractProofSha256','privilegedMigrationProofSha256'].every((key) => /^[a-f0-9]{64}$/.test(proof[key] ?? '')) ||
    !['exactProductionScopeVerified','restrictedCapabilitiesVerified','finiteCredentialExpiryVerified','rollbackReviewed'].every((key) => proof[key] === true))
    throw new Error('Operator proof does not match the exact preparation');
  const captured = Date.parse(proof.capturedAt);
  const expires = Date.parse(proof.expiresAt);
  if (!Number.isFinite(captured) || !Number.isFinite(expires) || captured > context.now + 5000 ||
    context.now - captured > 3600000 || expires <= context.now || expires > context.expiry)
    throw new Error('Operator proof is stale or over-approved');
  return true;
}

export async function preparePrimaryInterestActivation(input) {
  const now = (input.now ?? Date.now)();
  const expiry = Date.parse(input.expiresAt);
  if (!Number.isFinite(now) || !Number.isFinite(expiry) || expiry <= now || expiry - now > 86400000)
    throw new Error('Preparation requires a bounded future expiry');
  const inventory = input.hostInventory;
  if (!inventory || inventory.host !== 'bassey@82.29.190.219' || inventory.evidenceSource !== 'authorized_host_metadata' ||
    inventory.databaseInspected !== false || inventory.configurationValuesInspected !== false || inventory.activationAuthorized !== false ||
    Date.parse(inventory.capturedAt) > now + 5000 || !Number.isFinite(Date.parse(inventory.capturedAt)) || now - Date.parse(inventory.capturedAt) > 3600000)
    throw new Error('Fresh authorized host metadata is required');
  const packageRoot = await buildPrimaryPaidInterestInboxPackage(input.outputDirectory);
  const manifest = JSON.parse(await readFile(path.join(packageRoot, 'manifest.json'), 'utf8'));
  const inventoryBytes = `${JSON.stringify(inventory, null, 2)}\n`;
  const database = input.databaseInventory;
  const dbKeys = ['captured_at','session_is_fixed_login','tls','login_restricted','login_valid_until','sole_capability_membership',
    'capability_restricted','capability_parent_memberships','schema_usage','effective_primary_rpcs','direct_private_table_privileges',
    'public_interest_rpcs','interest_rpcs_present','customer_or_service_interest_execution'];
  if (database && (Object.keys(database).some((key) => !['restricted_inventory','authority_inventory'].includes(key)) ||
    !database.restricted_inventory || !database.authority_inventory ||
    Object.keys(database.restricted_inventory).some((key) => !dbKeys.includes(key)) ||
    Object.keys(database.authority_inventory).some((key) => !['exact_enabled_authority_ready','financial_actions'].includes(key))))
    throw new Error('Unsafe database inventory metadata');
  const db = database?.restricted_inventory;
  const credentialExpiry = Date.parse(db?.login_valid_until);
  const rpcNames = ['apply_inflow_environment','settle_savings','read_dispatched_savings','read_paid_interest_crosswalk',
    'apply_paid_interest','enqueue_paid_interest_inbox','claim_paid_interest_inbox','finish_paid_interest_inbox','paid_interest_inbox_readiness'];
  const databaseReady = !!db && ['session_is_fixed_login','tls','login_restricted','sole_capability_membership','capability_restricted','schema_usage','interest_rpcs_present'].every((key) => db[key]===true) &&
    ['capability_parent_memberships','direct_private_table_privileges','public_interest_rpcs','customer_or_service_interest_execution'].every((key) => db[key]===0) &&
    Number.isFinite(Date.parse(db.captured_at)) && Date.parse(db.captured_at)<=now+5000 && now-Date.parse(db.captured_at)<=3600000 &&
    Number.isFinite(credentialExpiry) && credentialExpiry>now && credentialExpiry<=expiry &&
    Array.isArray(db.effective_primary_rpcs) && db.effective_primary_rpcs.length===9 &&
    new Set(db.effective_primary_rpcs.map((rpc) => typeof rpc==='string' && rpc.slice(0,rpc.indexOf('(')))).size===9 &&
    db.effective_primary_rpcs.every((rpc) => typeof rpc==='string' && rpcNames.includes(rpc.slice(0,rpc.indexOf('(')))) &&
    database.authority_inventory.exact_enabled_authority_ready===true && database.authority_inventory.financial_actions===false;
  const databaseBytes = `${JSON.stringify(database ?? { status: 'not_supplied' }, null, 2)}\n`;
  const reviewed = inspectOperatorProof(input.operatorProof, { now, expiry, databaseReady, databaseDigest: digest(databaseBytes), inventoryDigest: digest(inventoryBytes), bundleDigest: manifest.artifacts['interest-inbox.cjs'] });
  const effectiveExpiry = reviewed ? new Date(Math.min(expiry, Date.parse(input.operatorProof.expiresAt))).toISOString() : input.expiresAt;
  for (const [source, destination] of [
    ['primary-wallet-paid-interest-activation-guard.mjs','activation-guard.mjs'],
    ['primary-wallet-paid-interest-host-inventory.mjs','host-inventory.mjs'],
    ['primary-wallet-paid-interest-db-inventory.sql','restricted-db-inventory.sql'],
  ]) await copyFile(path.join(directory, source), path.join(packageRoot, destination));
  await writeFile(path.join(packageRoot, 'host-inventory.json'), inventoryBytes, { mode: 0o600 });
  await writeFile(path.join(packageRoot, 'database-inventory.json'), databaseBytes, { mode: 0o600 });
  await writeFile(path.join(packageRoot, 'operator-proof.json'), JSON.stringify(input.operatorProof ?? { status: 'not_supplied' }, null, 2), { mode: 0o600 });
  await writeFile(path.join(packageRoot, 'runtime.env.example'), `${flags.join('\n')}\n${required.map((name) => `${name}=OWNER_SECRET_OR_VERIFIED_SCOPE_REQUIRED`).join('\n')}\nPIGGYVEST_PRIMARY_PAID_INTEREST_RETAINED_WEBHOOK_SECRETS=[]\n`, { mode: 0o600 });
  await writeFile(path.join(packageRoot, 'worker-expiry.conf'), `[Service]\nExecStartPre=\nExecStartPre=/usr/bin/node /opt/baci/primary-paid-interest/activation-guard.mjs --owner-gate /opt/baci/primary-paid-interest\nExecStartPre=/usr/bin/node /opt/baci/primary-paid-interest/interest-inbox.cjs --readiness\n`, { mode: 0o600 });
  const actions = {
    purpose: 'Review-only desired changes; no executable apply mode', host: inventory.host,
    activationAuthorized: false, requiresOwnerApproval: true,
    identity: { osAccount: 'baci-primary-interest-inbox', noLoginShell: '/usr/sbin/nologin', dbLogin: 'baci_piggyvest_primary_evidence', soleDbGroup: 'piggyvest_primary_evidence' },
    install: [
      { source: 'sealed package directory', target: '/opt/baci/primary-paid-interest', owner: 'root:root', directoryMode: '0755', artifactFileMode: '0644', required: 'Fresh privileged absence/current-artifact comparison and backup; no overwrite on mismatch. Nonsecret sealed assets must be readable by the worker.' },
      { source: 'owner secret delivery, not runtime.env.example', target: '/etc/baci/primary-paid-interest.env', owner: 'root:root', mode: '0600', required: 'Do not print, source in an interactive shell, or package real values' },
      { source: 'owner approval metadata', target: '/opt/baci/primary-paid-interest/owner-approval.json', owner: 'root:baci-primary-interest-inbox', mode: '0640', required: 'Nonsecret approval metadata must be worker-readable and root-writable only. Approve exact SHA256SUMS digest, separate install/start/capability/provider/migration/rollback decisions, expiry no later than preparation.' },
      { source: 'baci-primary-paid-interest.service', target: '/etc/systemd/system/baci-primary-paid-interest.service', owner: 'root:root', mode: '0644' },
      { source: 'baci-primary-paid-interest.timer', target: '/etc/systemd/system/baci-primary-paid-interest.timer', owner: 'root:root', mode: '0644' },
      { source: 'worker-expiry.conf', target: '/etc/systemd/system/baci-primary-paid-interest.service.d/10-owner-gates.conf', owner: 'root:root', mode: '0644', required: 'Mandatory expiry and sealed-artifact gate, not optional' },
    ],
    prerequisiteProofs: ['Privileged migration replay/installed signature + ACL/RLS receipt','Exact existing enabled inflow authority and business scope','Sole non-elevated evidence membership with no direct table grants','Finite DB credential validity within approval; coordinate existing shared evidence login, do not rotate/rebind it here','Provider crosswalk and full-net opted-in plan policy','Quarantine monitoring and restricted operator reconciliation','Old-key retention and outer webhook rotation gate'],
    ownerOnlySequence: [
      ['node','/opt/baci/primary-paid-interest/activation-guard.mjs','--verify','/opt/baci/primary-paid-interest'],
      ['systemd-analyze','verify','/etc/systemd/system/baci-primary-paid-interest.service','/etc/systemd/system/baci-primary-paid-interest.timer'],
      ['systemctl','daemon-reload'],
      ['systemctl','start','baci-primary-paid-interest.service'],
      ['systemctl','enable','--now','baci-primary-paid-interest.timer'],
    ],
    rollbackOwnerOnly: [['systemctl','disable','--now','baci-primary-paid-interest.timer'],['systemctl','stop','baci-primary-paid-interest.service']],
    rollbackPreserves: ['All signed inbox receipts, payout ledger, observations, claims and quarantine','Ordinary wallet cash and principal','Shared bank/card/mobile configuration and DB authority'],
    rollbackArtifactPolicy: 'After stopping only this worker, restore only exact prior backed-up file hashes/modes or remove only proven newly installed owned files. No blind deletion, inbox purge, role revocation or credential rotation. A committed payout is not refunded by stopping the worker.',
  };
  await writeFile(path.join(packageRoot, 'owner-actions.review.json'), JSON.stringify(actions, null, 2), { mode: 0o600 });
  await writeFile(path.join(packageRoot, 'owner-approval.example.json'), JSON.stringify({ preparedSealSha256: 'OWNER_REVIEW_REQUIRED', expiresAt: effectiveExpiry,
    artifactInstallationApproved: false, schedulerStartApproved: false, restrictedConfigurationApproved: false,
    migrationReplayVerified: false, operatorProviderProofVerified: false, rollbackApproved: false }, null, 2), { mode: 0o600 });
  await writeFile(path.join(packageRoot, 'preparation.json'), JSON.stringify({ version: 1, purpose: 'Interest-only sealed prepare-only activation review',
    createdAt: new Date(now).toISOString(), expiresAt: effectiveExpiry, activationAuthorized: false,
    operatorEvidenceReviewed: reviewed, evidenceClassification: reviewed ? 'operator_attestation_not_independently_verified' : 'host_metadata_only',
    hostInventorySha256: digest(inventoryBytes), databaseInventorySha256: digest(databaseBytes), candidateBundleSha256: manifest.artifacts['interest-inbox.cjs'],
    currentHostLayoutKnown: !Object.values(inventory.paths ?? {}).some((item) => item.state==='unreadable'), liveDatabaseVerified: false, providerDeliveryVerified: false,
    missingGates: reviewed ? ['Separate exact owner activation approval','Fresh privileged installed-state comparison','Worker readiness and observed post-start counters'] : ['Restricted live DB inventory and migration replay proof','Exact provider crosswalk/net eligibility proof','Finite credential expiry and shared-login owner coordination','Reviewed rollback inventory','Separate install/start approvals'],
  }, null, 2), { mode: 0o600 });
  const entries = [];
  for (const filename of (await readdir(packageRoot)).sort()) entries.push(`${digest(await readFile(path.join(packageRoot, filename)))}  ${filename}`);
  await writeFile(path.join(packageRoot, 'SHA256SUMS'), `${entries.join('\n')}\n`, { mode: 0o600 });
  return { directory: packageRoot, sealSha256: digest(`${entries.join('\n')}\n`), activationAuthorized: false, operatorEvidenceReviewed: reviewed };
}
