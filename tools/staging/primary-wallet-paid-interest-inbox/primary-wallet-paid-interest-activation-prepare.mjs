import { validatePrimaryInterestOperatorProof } from './primary-wallet-paid-interest-activation-proof.mjs';
import { createHash } from 'node:crypto';
import { copyFile, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPrimaryInterestActivationArtifacts } from './primary-wallet-paid-interest-activation-artifacts.mjs';
import { buildPrimaryPaidInterestInboxPackage } from './primary-wallet-paid-interest-inbox-package.mjs';

const directory = path.dirname(fileURLToPath(import.meta.url));
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const flags = [
  'VERCEL_ENV=production',
  'PIGGYVEST_PRIMARY_ENVIRONMENT=production',
  'PIGGYVEST_PRIMARY_PAID_INTEREST_INBOX_ENABLED=true',
  'PIGGYVEST_PRIMARY_PAID_INTEREST_ENABLED=true',
  'PIGGYVEST_PRIMARY_PAID_INTEREST_WORKER_APPROVED=true',
];
const required = [
  'PIGGYVEST_PRIMARY_INTEGRATION_ID',
  'PIGGYVEST_PRIMARY_PAID_INTEREST_BUSINESS_ID',
  'PIGGYVEST_PRIMARY_PAID_INTEREST_API_TOKEN',
  'PIGGYVEST_PRIMARY_PAID_INTEREST_WEBHOOK_SECRET',
  'PIGGYVEST_PRIMARY_DB_HOST',
  'PIGGYVEST_PRIMARY_DB_PORT',
  'PIGGYVEST_PRIMARY_DB_NAME',
  'PIGGYVEST_PRIMARY_EVIDENCE_DB_PASSWORD',
  'PIGGYVEST_PRIMARY_DB_CA',
];


export async function preparePrimaryInterestActivation(input) {
  const now = (input.now ?? Date.now)();
  const expiry = Date.parse(input.expiresAt);
  if (
    !Number.isFinite(now) ||
    !Number.isFinite(expiry) ||
    expiry <= now ||
    expiry - now > 86400000
  )
    throw new Error('Preparation requires a bounded future expiry');
  const inventory = input.hostInventory;
  if (
    !inventory ||
    inventory.host !== 'bassey@82.29.190.219' ||
    inventory.evidenceSource !== 'authorized_host_metadata' ||
    inventory.databaseInspected !== false ||
    inventory.configurationValuesInspected !== false ||
    inventory.activationAuthorized !== false ||
    Date.parse(inventory.capturedAt) > now + 5000 ||
    !Number.isFinite(Date.parse(inventory.capturedAt)) ||
    now - Date.parse(inventory.capturedAt) > 3600000
  )
    throw new Error('Fresh authorized host metadata is required');
  const packageRoot = await buildPrimaryPaidInterestInboxPackage(
    input.outputDirectory
  );
  const manifest = JSON.parse(
    await readFile(path.join(packageRoot, 'manifest.json'), 'utf8')
  );
  const inventoryBytes = `${JSON.stringify(inventory, null, 2)}\n`;
  const database = input.databaseInventory;
  const dbKeys = [
    'captured_at',
    'session_is_fixed_login',
    'tls',
    'login_restricted',
    'login_valid_until',
    'sole_capability_membership',
    'capability_restricted',
    'capability_parent_memberships',
    'schema_usage',
    'effective_primary_rpcs',
    'direct_private_table_privileges',
    'public_interest_rpcs',
    'interest_rpcs_present',
    'customer_or_service_interest_execution',
  ];
  if (
    database &&
    (Object.keys(database).some(
      (key) => !['restricted_inventory', 'authority_inventory'].includes(key)
    ) ||
      !database.restricted_inventory ||
      !database.authority_inventory ||
      Object.keys(database.restricted_inventory).some(
        (key) => !dbKeys.includes(key)
      ) ||
      Object.keys(database.authority_inventory).some(
        (key) =>
          !['exact_enabled_authority_ready', 'financial_actions'].includes(key)
      ))
  )
    throw new Error('Unsafe database inventory metadata');
  const db = database?.restricted_inventory;
  const credentialExpiry = Date.parse(db?.login_valid_until);
  const rpcNames = [
    'apply_inflow_environment',
    'settle_savings',
    'read_dispatched_savings',
    'read_paid_interest_crosswalk',
    'apply_paid_interest',
    'enqueue_paid_interest_inbox',
    'claim_paid_interest_inbox',
    'finish_paid_interest_inbox',
    'paid_interest_inbox_readiness',
  ];
  const databaseReady =
    !!db &&
    [
      'session_is_fixed_login',
      'tls',
      'login_restricted',
      'sole_capability_membership',
      'capability_restricted',
      'schema_usage',
      'interest_rpcs_present',
    ].every((key) => db[key] === true) &&
    [
      'capability_parent_memberships',
      'direct_private_table_privileges',
      'public_interest_rpcs',
      'customer_or_service_interest_execution',
    ].every((key) => db[key] === 0) &&
    Number.isFinite(Date.parse(db.captured_at)) &&
    Date.parse(db.captured_at) <= now + 5000 &&
    now - Date.parse(db.captured_at) <= 3600000 &&
    Number.isFinite(credentialExpiry) &&
    credentialExpiry > now &&
    credentialExpiry <= expiry &&
    Array.isArray(db.effective_primary_rpcs) &&
    db.effective_primary_rpcs.length === 9 &&
    new Set(
      db.effective_primary_rpcs.map(
        (rpc) => typeof rpc === 'string' && rpc.slice(0, rpc.indexOf('('))
      )
    ).size === 9 &&
    db.effective_primary_rpcs.every(
      (rpc) =>
        typeof rpc === 'string' &&
        rpcNames.includes(rpc.slice(0, rpc.indexOf('(')))
    ) &&
    database.authority_inventory.exact_enabled_authority_ready === true &&
    database.authority_inventory.financial_actions === false;
  const databaseBytes = `${JSON.stringify(database ?? { status: 'not_supplied' }, null, 2)}\n`;
  const reviewed = validatePrimaryInterestOperatorProof(input.operatorProof, {
    now,
    expiry,
    databaseReady,
    databaseDigest: digest(databaseBytes),
    inventoryDigest: digest(inventoryBytes),
    bundleDigest: manifest.artifacts['interest-inbox.cjs'],
  });
  const effectiveExpiry = reviewed
    ? new Date(
        Math.min(expiry, Date.parse(input.operatorProof.expiresAt))
      ).toISOString()
    : input.expiresAt;
  for (const [source, destination] of [
    [
      'primary-wallet-paid-interest-activation-guard.mjs',
      'activation-guard.mjs',
    ],
    ['primary-wallet-paid-interest-host-inventory.mjs', 'host-inventory.mjs'],
    [
      'primary-wallet-paid-interest-db-inventory.sql',
      'restricted-db-inventory.sql',
    ],
  ])
    await copyFile(
      path.join(directory, source),
      path.join(packageRoot, destination)
    );
  await writeFile(
    path.join(packageRoot, 'host-inventory.json'),
    inventoryBytes,
    { mode: 0o600 }
  );
  await writeFile(
    path.join(packageRoot, 'database-inventory.json'),
    databaseBytes,
    { mode: 0o600 }
  );
  await writeFile(
    path.join(packageRoot, 'operator-proof.json'),
    JSON.stringify(input.operatorProof ?? { status: 'not_supplied' }, null, 2),
    { mode: 0o600 }
  );
  await writeFile(
    path.join(packageRoot, 'runtime.env.example'),
    `${flags.join('\n')}\n${required.map((name) => `${name}=OWNER_SECRET_OR_VERIFIED_SCOPE_REQUIRED`).join('\n')}\nPIGGYVEST_PRIMARY_PAID_INTEREST_RETAINED_WEBHOOK_SECRETS=[]\n`,
    { mode: 0o600 }
  );
  await writeFile(
    path.join(packageRoot, 'worker-expiry.conf'),
    `[Service]\nExecStartPre=\nExecStartPre=/usr/bin/node /opt/baci/primary-paid-interest/activation-guard.mjs --owner-gate /opt/baci/primary-paid-interest\nExecStartPre=/usr/bin/node /opt/baci/primary-paid-interest/interest-inbox.cjs --readiness\n`,
    { mode: 0o600 }
  );
  return buildPrimaryInterestActivationArtifacts({
    packageRoot,
    inventory,
    now,
    effectiveExpiry,
    reviewed,
    inventoryBytes,
    databaseBytes,
    manifest,
  });
}
