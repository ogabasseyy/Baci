import { createHash } from 'node:crypto';
import { copyFile, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPrimaryCardTransferPackage } from './primary-wallet-card-transfer-package.mjs';

const directory = path.dirname(fileURLToPath(import.meta.url));
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const flags = ['VERCEL_ENV=production','PIGGYVEST_PRIMARY_CARD_ENVIRONMENT=production',
  'PIGGYVEST_PRIMARY_CARD_TRANSFER_PROVIDER_ENABLED=true','PIGGYVEST_PRIMARY_CARD_SIGNED_INBOX_ENABLED=true',
  'PIGGYVEST_PRIMARY_CARD_CUSTODY_ENABLED=true','PIGGYVEST_PRIMARY_CARD_TRANSFER_SCHEDULED=true'];
const required = ['PIGGYVEST_PRIMARY_CARD_INTEGRATION_ID','PIGGYVEST_PRIMARY_CARD_MERCHANT_ID','PIGGYVEST_PRIMARY_CARD_BUSINESS_ID',
  'PIGGYVEST_PRIMARY_CARD_EXPIRES_AT','PIGGYVEST_PRIMARY_CARD_PIGGYVEST_TOKEN','PIGGYVEST_PRIMARY_CARD_CROSSWALK_CONTRACT_ID',
  'PIGGYVEST_PRIMARY_CARD_CROSSWALK_ISSUER','PIGGYVEST_PRIMARY_CARD_TREASURY_WEBHOOK_CUSTOMER_ID',
  'PIGGYVEST_PRIMARY_CARD_TRANSACTION_CUSTOMER_ID','PIGGYVEST_PRIMARY_CARD_DB_HOST','PIGGYVEST_PRIMARY_CARD_DB_PORT',
  'PIGGYVEST_PRIMARY_CARD_DB_NAME','PIGGYVEST_PRIMARY_CARD_DB_CA','PIGGYVEST_PRIMARY_CARD_TRANSFER_PASSWORD',
  'PIGGYVEST_PRIMARY_CARD_TRANSFER_POLICY_BYTES','PIGGYVEST_PRIMARY_CARD_TRANSFER_POLICY_SIGNATURE',
  'PIGGYVEST_PRIMARY_CARD_TRANSFER_POLICY_ISSUER_KEY'];

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

export async function preparePrimaryTransferActivation(input) {
  const now = (input.now ?? Date.now)();
  const expiry = Date.parse(input.expiresAt);
  if (!Number.isFinite(now) || !Number.isFinite(expiry) || expiry <= now || expiry - now > 86400000)
    throw new Error('Preparation requires a bounded future expiry');
  const inventory = input.hostInventory;
  if (!inventory || inventory.host !== 'bassey@82.29.190.219' || inventory.evidenceSource !== 'authorized_host_metadata' ||
    typeof inventory.instance !== 'string' || !/^[a-zA-Z0-9_.-]{1,64}$/.test(inventory.instance) || /^\.+$/.test(inventory.instance) ||
    inventory.databaseInspected !== false || inventory.configurationValuesInspected !== false || inventory.activationAuthorized !== false ||
    Date.parse(inventory.capturedAt) > now + 5000 || !Number.isFinite(Date.parse(inventory.capturedAt)) || now - Date.parse(inventory.capturedAt) > 3600000)
    throw new Error('Fresh authorized host metadata is required');
  const instance = inventory.instance;
  await buildPrimaryCardTransferPackage(input.outputDirectory);
  const packageRoot = path.resolve(input.outputDirectory);
  const manifest = JSON.parse(await readFile(path.join(packageRoot, 'artifact.manifest.json'), 'utf8'));
  const inventoryBytes = `${JSON.stringify(inventory, null, 2)}\n`;
  const database = input.databaseInventory;
  const dbKeys = ['captured_at','session_is_fixed_login','tls','login_restricted','login_valid_until','sole_capability_membership',
    'capability_restricted','capability_parent_memberships','schema_usage','effective_primary_rpcs','direct_private_table_privileges',
    'public_transfer_rpcs','transfer_rpcs_present','customer_or_service_transfer_execution'];
  if (database && (Object.keys(database).some((key) => !['restricted_inventory','authority_inventory'].includes(key)) ||
    !database.restricted_inventory || !database.authority_inventory ||
    Object.keys(database.restricted_inventory).some((key) => !dbKeys.includes(key)) ||
    Object.keys(database.authority_inventory).some((key) => !['exact_enabled_authority_ready','financial_actions'].includes(key))))
    throw new Error('Unsafe database inventory metadata');
  const db = database?.restricted_inventory;
  const credentialExpiry = Date.parse(db?.login_valid_until);
  const rpcNames = ['claim_transfer','record_transfer','dispatch_context','select_ready_transfers'];
  const databaseReady = !!db && ['session_is_fixed_login','tls','login_restricted','sole_capability_membership','capability_restricted','schema_usage','transfer_rpcs_present'].every((key) => db[key]===true) &&
    ['capability_parent_memberships','direct_private_table_privileges','public_transfer_rpcs','customer_or_service_transfer_execution'].every((key) => db[key]===0) &&
    Number.isFinite(Date.parse(db.captured_at)) && Date.parse(db.captured_at)<=now+5000 && now-Date.parse(db.captured_at)<=3600000 &&
    Number.isFinite(credentialExpiry) && credentialExpiry>now && credentialExpiry<=expiry &&
    Array.isArray(db.effective_primary_rpcs) && db.effective_primary_rpcs.length===4 &&
    new Set(db.effective_primary_rpcs.map((rpc) => typeof rpc==='string' && rpc.slice(0,rpc.indexOf('(')))).size===4 &&
    db.effective_primary_rpcs.every((rpc) => typeof rpc==='string' && rpcNames.includes(rpc.slice(0,rpc.indexOf('(')))) &&
    database.authority_inventory.exact_enabled_authority_ready===true && database.authority_inventory.financial_actions===false;
  const databaseBytes = `${JSON.stringify(database ?? { status: 'not_supplied' }, null, 2)}\n`;
  const reviewed = inspectOperatorProof(input.operatorProof, { now, expiry, databaseReady, databaseDigest: digest(databaseBytes), inventoryDigest: digest(inventoryBytes), bundleDigest: manifest.outputSha256['transfer.cjs'] });
  const effectiveExpiry = reviewed ? new Date(Math.min(expiry, Date.parse(input.operatorProof.expiresAt))).toISOString() : input.expiresAt;
  for (const [source, destination] of [
    ['primary-wallet-card-transfer-activation-guard.mjs','activation-guard.mjs'],
    ['primary-wallet-card-transfer-host-inventory.mjs','host-inventory.mjs'],
    ['primary-wallet-card-transfer-db-inventory.sql','restricted-db-inventory.sql'],
  ]) await copyFile(path.join(directory, source), path.join(packageRoot, destination));
  await writeFile(path.join(packageRoot, 'host-inventory.json'), inventoryBytes, { mode: 0o600 });
  await writeFile(path.join(packageRoot, 'database-inventory.json'), databaseBytes, { mode: 0o600 });
  await writeFile(path.join(packageRoot, 'operator-proof.json'), JSON.stringify(input.operatorProof ?? { status: 'not_supplied' }, null, 2), { mode: 0o600 });
  await writeFile(path.join(packageRoot, 'runtime.env.example'), `${flags.join('\n')}\n${required.map((name) => `${name}=OWNER_SECRET_OR_VERIFIED_SCOPE_REQUIRED`).join('\n')}\n`, { mode: 0o600 });
  await writeFile(path.join(packageRoot, 'worker-expiry.conf'), `[Service]\nExecStartPre=\nExecStartPre=/usr/bin/node /opt/baci/primary-card-transfer/activation-guard.mjs --owner-gate /opt/baci/primary-card-transfer\nExecStartPre=/usr/bin/node /opt/baci/primary-card-transfer/transfer.cjs --readiness\n`, { mode: 0o600 });
  const actions = {
    purpose: 'Review-only desired changes; no executable apply mode', host: inventory.host, instance,
    activationAuthorized: false, requiresOwnerApproval: true,
    identity: { osAccount: 'baci-primary-card-transfer', noLoginShell: '/usr/sbin/nologin', dbLogin: 'baci_primary_card_transfer', soleDbGroup: 'primary_card_transfer_worker' },
    install: [
      { source: 'sealed package directory', target: '/opt/baci/primary-card-transfer', owner: 'root:root', directoryMode: '0755', artifactFileMode: '0644', required: 'Fresh privileged absence/current-artifact comparison and backup; no overwrite on mismatch. Nonsecret sealed assets must be readable by the worker.' },
      { source: 'owner secret delivery, not runtime.env.example', target: `/etc/baci/primary-card-transfer-${instance}.env`, owner: 'root:root', mode: '0600', required: 'Do not print, source in an interactive shell, or package real values. Never place custody or intake passwords in the transfer worker environment; the launcher rejects either.' },
      { source: 'owner approval metadata', target: '/opt/baci/primary-card-transfer/owner-approval.json', owner: 'root:baci-primary-card-transfer', mode: '0640', required: 'Nonsecret approval metadata must be worker-readable and root-writable only. Approve exact SHA256SUMS digest, separate install/start/capability/provider/migration/rollback decisions, expiry no later than preparation.' },
      { source: 'baci-primary-card-transfer@.service', target: '/etc/systemd/system/baci-primary-card-transfer@.service', owner: 'root:root', mode: '0644' },
      { source: 'baci-primary-card-transfer@.timer', target: '/etc/systemd/system/baci-primary-card-transfer@.timer', owner: 'root:root', mode: '0644' },
      { source: 'worker-expiry.conf', target: `/etc/systemd/system/baci-primary-card-transfer@${instance}.service.d/10-owner-gates.conf`, owner: 'root:root', mode: '0644', required: 'Mandatory expiry and sealed-artifact gate, not optional' },
    ],
    prerequisiteProofs: ['Privileged migration replay/installed signature + ACL receipt','Exact enabled transfer authority, treasury policy and binding','Sole non-elevated transfer membership with no direct table grants','Finite DB credential validity within approval','Approved reusable transfer policy, issuer key and exhaustive alias contract','Separately scheduled custody receipt worker with signed proof settlement','Quarantine monitoring and restricted operator reconciliation'],
    ownerOnlySequence: [
      ['node','/opt/baci/primary-card-transfer/activation-guard.mjs','--verify','/opt/baci/primary-card-transfer'],
      ['systemd-analyze','verify',`/etc/systemd/system/baci-primary-card-transfer@${instance}.service`,`/etc/systemd/system/baci-primary-card-transfer@${instance}.timer`],
      ['systemctl','daemon-reload'],
      ['systemctl','start',`baci-primary-card-transfer@${instance}.service`],
      ['systemctl','enable','--now',`baci-primary-card-transfer@${instance}.timer`],
    ],
    rollbackOwnerOnly: [['systemctl','disable','--now',`baci-primary-card-transfer@${instance}.timer`],['systemctl','stop',`baci-primary-card-transfer@${instance}.service`]],
    rollbackPreserves: ['Transfer outbox, operations, reservations, collections and custody proofs','Ordinary wallet cash and principal','Shared bank/interest/mobile configuration and DB authority'],
    rollbackArtifactPolicy: 'After stopping only this worker, restore only exact prior backed-up file hashes/modes or remove only proven newly installed owned files. No blind deletion, outbox purge, role revocation or credential rotation. A submitted transfer is not recalled by stopping the worker; unknown/dispatching operations stay fenced for signed custody reconciliation.',
  };
  await writeFile(path.join(packageRoot, 'owner-actions.review.json'), JSON.stringify(actions, null, 2), { mode: 0o600 });
  await writeFile(path.join(packageRoot, 'owner-approval.example.json'), JSON.stringify({ preparedSealSha256: 'OWNER_REVIEW_REQUIRED', expiresAt: effectiveExpiry,
    artifactInstallationApproved: false, schedulerStartApproved: false, restrictedConfigurationApproved: false,
    migrationReplayVerified: false, operatorProviderProofVerified: false, rollbackApproved: false }, null, 2), { mode: 0o600 });
  await writeFile(path.join(packageRoot, 'preparation.json'), JSON.stringify({ version: 1, purpose: 'Transfer-only sealed prepare-only activation review',
    createdAt: new Date(now).toISOString(), expiresAt: effectiveExpiry, activationAuthorized: false,
    operatorEvidenceReviewed: reviewed, evidenceClassification: reviewed ? 'operator_attestation_not_independently_verified' : 'host_metadata_only',
    hostInventorySha256: digest(inventoryBytes), databaseInventorySha256: digest(databaseBytes), candidateBundleSha256: manifest.outputSha256['transfer.cjs'],
    currentHostLayoutKnown: !Object.values(inventory.paths ?? {}).some((item) => item.state==='unreadable'), liveDatabaseVerified: false, providerDeliveryVerified: false,
    missingGates: reviewed ? ['Separate exact owner activation approval','Fresh privileged installed-state comparison','Worker readiness and observed post-start counters'] : ['Restricted live DB inventory and migration replay proof','Exact treasury policy and reusable alias contract proof','Finite credential expiry and owner coordination','Reviewed rollback inventory','Separate install/start approvals'],
  }, null, 2), { mode: 0o600 });
  const entries = [];
  for (const filename of (await readdir(packageRoot)).sort()) entries.push(`${digest(await readFile(path.join(packageRoot, filename)))}  ${filename}`);
  await writeFile(path.join(packageRoot, 'SHA256SUMS'), `${entries.join('\n')}\n`, { mode: 0o600 });
  return { directory: packageRoot, sealSha256: digest(`${entries.join('\n')}\n`), activationAuthorized: false, operatorEvidenceReviewed: reviewed };
}
