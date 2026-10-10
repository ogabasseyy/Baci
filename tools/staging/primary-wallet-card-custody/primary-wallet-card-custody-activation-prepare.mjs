import { createHash } from 'node:crypto';
import { copyFile, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPrimaryCardCustodyPackage } from './primary-wallet-card-custody-package.mjs';

const directory = path.dirname(fileURLToPath(import.meta.url));
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const flags = ['VERCEL_ENV=production','PIGGYVEST_PRIMARY_CARD_ENVIRONMENT=production',
  'PIGGYVEST_PRIMARY_CARD_CUSTODY_ENABLED=true','PIGGYVEST_PRIMARY_CARD_SIGNED_INBOX_ENABLED=true',
  'PIGGYVEST_PRIMARY_CARD_WORKER_APPROVED=true','PIGGYVEST_PRIMARY_CARD_CUSTODY_SCHEDULED=true'];
const required = ['PIGGYVEST_PRIMARY_CARD_INTEGRATION_ID','PIGGYVEST_PRIMARY_CARD_MERCHANT_ID','PIGGYVEST_PRIMARY_CARD_BUSINESS_ID',
  'PIGGYVEST_PRIMARY_CARD_EXPIRES_AT','PIGGYVEST_PRIMARY_CARD_CROSSWALK_CONTRACT_ID','PIGGYVEST_PRIMARY_CARD_CROSSWALK_ISSUER',
  'PIGGYVEST_PRIMARY_CARD_TREASURY_WEBHOOK_CUSTOMER_ID','PIGGYVEST_PRIMARY_CARD_TRANSACTION_CUSTOMER_ID',
  'PIGGYVEST_PRIMARY_CARD_SIGNED_PAYLOAD_CONTRACT','PIGGYVEST_PRIMARY_CARD_SIGNED_MAPPING_CONTRACT',
  'PIGGYVEST_PRIMARY_CARD_SIGNED_BATCH_SIZE','PIGGYVEST_PRIMARY_CARD_PIGGYVEST_TOKEN',
  'PIGGYVEST_PRIMARY_CARD_PIGGYVEST_WEBHOOK_SECRET','PIGGYVEST_PRIMARY_CARD_DB_HOST','PIGGYVEST_PRIMARY_CARD_DB_PORT',
  'PIGGYVEST_PRIMARY_CARD_DB_NAME','PIGGYVEST_PRIMARY_CARD_DB_CA','PIGGYVEST_PRIMARY_CARD_CUSTODY_PASSWORD',
  'PIGGYVEST_PRIMARY_CARD_CROSSWALK_FILE','PIGGYVEST_PRIMARY_CARD_CROSSWALK_FILE_SHA256',
  'PIGGYVEST_PRIMARY_CARD_CROSSWALK_FILE_SIGNATURE','PIGGYVEST_PRIMARY_CARD_CROSSWALK_DELIVERY_KEY'];

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

export async function preparePrimaryCustodyActivation(input) {
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
  await buildPrimaryCardCustodyPackage(input.outputDirectory);
  const packageRoot = path.resolve(input.outputDirectory);
  const manifest = JSON.parse(await readFile(path.join(packageRoot, 'artifact.manifest.json'), 'utf8'));
  const inventoryBytes = `${JSON.stringify(inventory, null, 2)}\n`;
  const database = input.databaseInventory;
  const dbKeys = ['captured_at','session_is_fixed_login','tls','login_restricted','login_valid_until','sole_capability_membership',
    'capability_restricted','capability_parent_memberships','schema_usage','effective_primary_rpcs','direct_private_table_privileges',
    'public_custody_rpcs','custody_rpcs_present','customer_or_service_custody_execution'];
  if (database && (Object.keys(database).some((key) => !['restricted_inventory','authority_inventory'].includes(key)) ||
    !database.restricted_inventory || !database.authority_inventory ||
    Object.keys(database.restricted_inventory).some((key) => !dbKeys.includes(key)) ||
    Object.keys(database.authority_inventory).some((key) => !['exact_enabled_authority_ready','financial_actions'].includes(key))))
    throw new Error('Unsafe database inventory metadata');
  const db = database?.restricted_inventory;
  const credentialExpiry = Date.parse(db?.login_valid_until);
  const rpcNames = ['transfer_context','settle_custody','signed_inbox_readiness','inbox_ready','enqueue_signed_inbox','claim_signed_inbox','resolve_signed_reference','finish_signed_inbox'];
  const databaseReady = !!db && ['session_is_fixed_login','tls','login_restricted','sole_capability_membership','capability_restricted','schema_usage','custody_rpcs_present'].every((key) => db[key]===true) &&
    ['capability_parent_memberships','direct_private_table_privileges','public_custody_rpcs','customer_or_service_custody_execution'].every((key) => db[key]===0) &&
    Number.isFinite(Date.parse(db.captured_at)) && Date.parse(db.captured_at)<=now+5000 && now-Date.parse(db.captured_at)<=3600000 &&
    Number.isFinite(credentialExpiry) && credentialExpiry>now && credentialExpiry<=expiry &&
    Array.isArray(db.effective_primary_rpcs) && db.effective_primary_rpcs.length===8 &&
    new Set(db.effective_primary_rpcs.map((rpc) => typeof rpc==='string' && rpc.slice(0,rpc.indexOf('(')))).size===8 &&
    db.effective_primary_rpcs.every((rpc) => typeof rpc==='string' && rpcNames.includes(rpc.slice(0,rpc.indexOf('(')))) &&
    database.authority_inventory.exact_enabled_authority_ready===true && database.authority_inventory.financial_actions===false;
  const databaseBytes = `${JSON.stringify(database ?? { status: 'not_supplied' }, null, 2)}\n`;
  const reviewed = inspectOperatorProof(input.operatorProof, { now, expiry, databaseReady, databaseDigest: digest(databaseBytes), inventoryDigest: digest(inventoryBytes), bundleDigest: manifest.outputSha256['custody.cjs'] });
  const effectiveExpiry = reviewed ? new Date(Math.min(expiry, Date.parse(input.operatorProof.expiresAt))).toISOString() : input.expiresAt;
  for (const [source, destination] of [
    ['primary-wallet-card-custody-activation-guard.mjs','activation-guard.mjs'],
    ['primary-wallet-card-custody-host-inventory.mjs','host-inventory.mjs'],
    ['primary-wallet-card-custody-db-inventory.sql','restricted-db-inventory.sql'],
  ]) await copyFile(path.join(directory, source), path.join(packageRoot, destination));
  await writeFile(path.join(packageRoot, 'host-inventory.json'), inventoryBytes, { mode: 0o600 });
  await writeFile(path.join(packageRoot, 'database-inventory.json'), databaseBytes, { mode: 0o600 });
  await writeFile(path.join(packageRoot, 'operator-proof.json'), JSON.stringify(input.operatorProof ?? { status: 'not_supplied' }, null, 2), { mode: 0o600 });
  await writeFile(path.join(packageRoot, 'runtime.env.example'), `${flags.join('\n')}\n${required.map((name) => `${name}=OWNER_SECRET_OR_VERIFIED_SCOPE_REQUIRED`).join('\n')}\nPIGGYVEST_PRIMARY_CARD_RETAINED_PIGGYVEST_WEBHOOK_SECRETS=[]\n`, { mode: 0o600 });
  await writeFile(path.join(packageRoot, 'worker-expiry.conf'), `[Service]\nExecStartPre=\nExecStartPre=/usr/bin/node /opt/baci/primary-card-custody/activation-guard.mjs --owner-gate /opt/baci/primary-card-custody\nExecStartPre=/usr/bin/node /opt/baci/primary-card-custody/custody.cjs --readiness\n`, { mode: 0o600 });
  const actions = {
    purpose: 'Review-only desired changes; no executable apply mode', host: inventory.host, instance,
    activationAuthorized: false, requiresOwnerApproval: true,
    identity: { osAccount: 'baci-primary-card-custody', noLoginShell: '/usr/sbin/nologin', dbLogin: 'baci_primary_card_custody', soleDbGroup: 'primary_card_custody_evidence' },
    install: [
      { source: 'sealed package directory', target: '/opt/baci/primary-card-custody', owner: 'root:root', directoryMode: '0755', artifactFileMode: '0644', required: 'Fresh privileged absence/current-artifact comparison and backup; no overwrite on mismatch. Nonsecret sealed assets must be readable by the worker.' },
      { source: 'owner secret delivery, not runtime.env.example', target: `/etc/baci/primary-card-custody-${instance}.env`, owner: 'root:root', mode: '0600', required: 'Do not print, source in an interactive shell, or package real values. Never place transfer or intake passwords in the custody worker environment; the launcher rejects either.' },
      { source: 'owner crosswalk delivery, out of band', target: 'PIGGYVEST_PRIMARY_CARD_CROSSWALK_FILE path', owner: 'root:worker', mode: '0600', required: 'Absolute private regular file, single link, no symlink, maximum 1 MiB, 0600, owned by root or the worker UID. HMAC-signed by the approved issuer delivery key over exact bytes; hash and signature pinned in the environment. Never package the crosswalk inside the sealed bundle.' },
      { source: 'owner approval metadata', target: '/opt/baci/primary-card-custody/owner-approval.json', owner: 'root:baci-primary-card-custody', mode: '0640', required: 'Nonsecret approval metadata must be worker-readable and root-writable only. Approve exact SHA256SUMS digest, separate install/start/capability/provider/migration/rollback decisions, expiry no later than preparation.' },
      { source: 'baci-primary-card-custody@.service', target: '/etc/systemd/system/baci-primary-card-custody@.service', owner: 'root:root', mode: '0644' },
      { source: 'baci-primary-card-custody@.timer', target: '/etc/systemd/system/baci-primary-card-custody@.timer', owner: 'root:root', mode: '0644' },
      { source: 'worker-expiry.conf', target: `/etc/systemd/system/baci-primary-card-custody@${instance}.service.d/10-owner-gates.conf`, owner: 'root:root', mode: '0644', required: 'Mandatory expiry and sealed-artifact gate, not optional' },
    ],
    prerequisiteProofs: ['Privileged migration replay/installed signature + ACL receipt','Exact enabled custody authority, inbox capability and treasury policy','Sole non-elevated custody membership with no direct table grants','Finite DB credential validity within approval','Approved authenticated crosswalk file, issuer key and exhaustive alias evidence','Separately scheduled financial transfer worker with fenced one-attempt dispatch','Quarantine monitoring and restricted operator reconciliation'],
    ownerOnlySequence: [
      ['node','/opt/baci/primary-card-custody/activation-guard.mjs','--verify','/opt/baci/primary-card-custody'],
      ['systemd-analyze','verify',`/etc/systemd/system/baci-primary-card-custody@${instance}.service`,`/etc/systemd/system/baci-primary-card-custody@${instance}.timer`],
      ['systemctl','daemon-reload'],
      ['systemctl','start',`baci-primary-card-custody@${instance}.service`],
      ['systemctl','enable','--now',`baci-primary-card-custody@${instance}.timer`],
    ],
    rollbackOwnerOnly: [['systemctl','disable','--now',`baci-primary-card-custody@${instance}.timer`],['systemctl','stop',`baci-primary-card-custody@${instance}.service`]],
    rollbackPreserves: ['Signed inbox receipts, custody proofs, settlement ledger and observations','Ordinary wallet cash and principal','Shared bank/interest/mobile configuration and DB authority'],
    rollbackArtifactPolicy: 'After stopping only this worker, restore only exact prior backed-up file hashes/modes or remove only proven newly installed owned files. No blind deletion, inbox purge, role revocation or credential rotation. A settled custody credit is not reversed by stopping the worker.',
  };
  await writeFile(path.join(packageRoot, 'owner-actions.review.json'), JSON.stringify(actions, null, 2), { mode: 0o600 });
  await writeFile(path.join(packageRoot, 'owner-approval.example.json'), JSON.stringify({ preparedSealSha256: 'OWNER_REVIEW_REQUIRED', expiresAt: effectiveExpiry,
    artifactInstallationApproved: false, schedulerStartApproved: false, restrictedConfigurationApproved: false,
    migrationReplayVerified: false, operatorProviderProofVerified: false, rollbackApproved: false }, null, 2), { mode: 0o600 });
  await writeFile(path.join(packageRoot, 'preparation.json'), JSON.stringify({ version: 1, purpose: 'Custody-only sealed prepare-only activation review',
    createdAt: new Date(now).toISOString(), expiresAt: effectiveExpiry, activationAuthorized: false,
    operatorEvidenceReviewed: reviewed, evidenceClassification: reviewed ? 'operator_attestation_not_independently_verified' : 'host_metadata_only',
    hostInventorySha256: digest(inventoryBytes), databaseInventorySha256: digest(databaseBytes), candidateBundleSha256: manifest.outputSha256['custody.cjs'],
    currentHostLayoutKnown: !Object.values(inventory.paths ?? {}).some((item) => item.state==='unreadable'), liveDatabaseVerified: false, providerDeliveryVerified: false,
    missingGates: reviewed ? ['Separate exact owner activation approval','Fresh privileged installed-state comparison','Worker readiness and observed post-start counters'] : ['Restricted live DB inventory and migration replay proof','Exact crosswalk delivery and alias evidence proof','Finite credential expiry and owner coordination','Reviewed rollback inventory','Separate install/start approvals'],
  }, null, 2), { mode: 0o600 });
  const entries = [];
  for (const filename of (await readdir(packageRoot)).sort()) entries.push(`${digest(await readFile(path.join(packageRoot, filename)))}  ${filename}`);
  await writeFile(path.join(packageRoot, 'SHA256SUMS'), `${entries.join('\n')}\n`, { mode: 0o600 });
  return { directory: packageRoot, sealSha256: digest(`${entries.join('\n')}\n`), activationAuthorized: false, operatorEvidenceReviewed: reviewed };
}
