import { createHash } from 'node:crypto';
import { copyFile, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPrimaryTransferOwnerActions } from './primary-wallet-card-transfer-activation-actions.mjs';
import { validatePrimaryTransferActivationProof } from './primary-wallet-card-transfer-activation-proof.mjs';
import { buildPrimaryCardTransferPackage } from './primary-wallet-card-transfer-package.mjs';

const directory = path.dirname(fileURLToPath(import.meta.url));
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const flags = [
  'VERCEL_ENV=production',
  'PIGGYVEST_PRIMARY_CARD_ENVIRONMENT=production',
  'PIGGYVEST_PRIMARY_CARD_TRANSFER_PROVIDER_ENABLED=true',
  'PIGGYVEST_PRIMARY_CARD_SIGNED_INBOX_ENABLED=true',
  'PIGGYVEST_PRIMARY_CARD_CUSTODY_ENABLED=true',
  'PIGGYVEST_PRIMARY_CARD_TRANSFER_SCHEDULED=true',
];
const required = [
  'PIGGYVEST_PRIMARY_CARD_INTEGRATION_ID',
  'PIGGYVEST_PRIMARY_CARD_MERCHANT_ID',
  'PIGGYVEST_PRIMARY_CARD_BUSINESS_ID',
  'PIGGYVEST_PRIMARY_CARD_EXPIRES_AT',
  'PIGGYVEST_PRIMARY_CARD_PIGGYVEST_TOKEN',
  'PIGGYVEST_PRIMARY_CARD_CROSSWALK_CONTRACT_ID',
  'PIGGYVEST_PRIMARY_CARD_CROSSWALK_ISSUER',
  'PIGGYVEST_PRIMARY_CARD_TREASURY_WEBHOOK_CUSTOMER_ID',
  'PIGGYVEST_PRIMARY_CARD_TRANSACTION_CUSTOMER_ID',
  'PIGGYVEST_PRIMARY_CARD_DB_HOST',
  'PIGGYVEST_PRIMARY_CARD_DB_PORT',
  'PIGGYVEST_PRIMARY_CARD_DB_NAME',
  'PIGGYVEST_PRIMARY_CARD_DB_CA',
  'PIGGYVEST_PRIMARY_CARD_TRANSFER_PASSWORD',
  'PIGGYVEST_PRIMARY_CARD_TRANSFER_POLICY_BYTES',
  'PIGGYVEST_PRIMARY_CARD_TRANSFER_POLICY_SIGNATURE',
  'PIGGYVEST_PRIMARY_CARD_TRANSFER_POLICY_ISSUER_KEY',
];

export async function preparePrimaryTransferActivation(input) {
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
    inventory?.host !== 'bassey@82.29.190.219' ||
    inventory.evidenceSource !== 'authorized_host_metadata' ||
    typeof inventory.instance !== 'string' ||
    !/^[a-zA-Z0-9_.-]{1,64}$/.test(inventory.instance) ||
    /^\.+$/.test(inventory.instance) ||
    inventory.databaseInspected !== false ||
    inventory.configurationValuesInspected !== false ||
    inventory.activationAuthorized !== false ||
    Date.parse(inventory.capturedAt) > now + 5000 ||
    !Number.isFinite(Date.parse(inventory.capturedAt)) ||
    now - Date.parse(inventory.capturedAt) > 3600000
  )
    throw new Error('Fresh authorized host metadata is required');
  const instance = inventory.instance;
  await buildPrimaryCardTransferPackage(input.outputDirectory);
  const packageRoot = path.resolve(input.outputDirectory);
  const manifest = JSON.parse(
    await readFile(path.join(packageRoot, 'artifact.manifest.json'), 'utf8')
  );
  const inventoryBytes = `${JSON.stringify(inventory, null, 2)}\n`;
  const { databaseBytes, reviewed, effectiveExpiry } =
    validatePrimaryTransferActivationProof({
      database: input.databaseInventory,
      operatorProof: input.operatorProof,
      now,
      expiry,
      inventoryBytes,
      expiresAt: input.expiresAt,
      bundleDigest: manifest.outputSha256['transfer.cjs'],
    });
  for (const [source, destination] of [
    [
      'primary-wallet-card-transfer-activation-guard.mjs',
      'activation-guard.mjs',
    ],
    ['primary-wallet-card-transfer-host-inventory.mjs', 'host-inventory.mjs'],
    [
      'primary-wallet-card-transfer-db-inventory.sql',
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
    `${flags.join('\n')}\n${required.map((name) => `${name}=OWNER_SECRET_OR_VERIFIED_SCOPE_REQUIRED`).join('\n')}\n`,
    { mode: 0o600 }
  );
  await writeFile(
    path.join(packageRoot, 'worker-expiry.conf'),
    `[Service]\nExecStartPre=\nExecStartPre=/usr/bin/node /opt/baci/primary-card-transfer/activation-guard.mjs --owner-gate /opt/baci/primary-card-transfer\nExecStartPre=/usr/bin/node /opt/baci/primary-card-transfer/transfer.cjs --readiness\n`,
    { mode: 0o600 }
  );
  const actions = buildPrimaryTransferOwnerActions({ inventory, instance });
  await writeFile(
    path.join(packageRoot, 'owner-actions.review.json'),
    JSON.stringify(actions, null, 2),
    { mode: 0o600 }
  );
  await writeFile(
    path.join(packageRoot, 'owner-approval.example.json'),
    JSON.stringify(
      {
        preparedSealSha256: 'OWNER_REVIEW_REQUIRED',
        expiresAt: effectiveExpiry,
        artifactInstallationApproved: false,
        schedulerStartApproved: false,
        restrictedConfigurationApproved: false,
        migrationReplayVerified: false,
        operatorProviderProofVerified: false,
        rollbackApproved: false,
      },
      null,
      2
    ),
    { mode: 0o600 }
  );
  await writeFile(
    path.join(packageRoot, 'preparation.json'),
    JSON.stringify(
      {
        version: 1,
        purpose: 'Transfer-only sealed prepare-only activation review',
        createdAt: new Date(now).toISOString(),
        expiresAt: effectiveExpiry,
        activationAuthorized: false,
        operatorEvidenceReviewed: reviewed,
        evidenceClassification: reviewed
          ? 'operator_attestation_not_independently_verified'
          : 'host_metadata_only',
        hostInventorySha256: digest(inventoryBytes),
        databaseInventorySha256: digest(databaseBytes),
        candidateBundleSha256: manifest.outputSha256['transfer.cjs'],
        currentHostLayoutKnown: !Object.values(inventory.paths ?? {}).some(
          (item) => item.state === 'unreadable'
        ),
        liveDatabaseVerified: false,
        providerDeliveryVerified: false,
        missingGates: reviewed
          ? [
              'Separate exact owner activation approval',
              'Fresh privileged installed-state comparison',
              'Worker readiness and observed post-start counters',
            ]
          : [
              'Restricted live DB inventory and migration replay proof',
              'Exact treasury policy and reusable alias contract proof',
              'Finite credential expiry and owner coordination',
              'Reviewed rollback inventory',
              'Separate install/start approvals',
            ],
      },
      null,
      2
    ),
    { mode: 0o600 }
  );
  const entries = [];
  for (const filename of (await readdir(packageRoot)).sort())
    entries.push(
      `${digest(await readFile(path.join(packageRoot, filename)))}  ${filename}`
    );
  await writeFile(
    path.join(packageRoot, 'SHA256SUMS'),
    `${entries.join('\n')}\n`,
    { mode: 0o600 }
  );
  return {
    directory: packageRoot,
    sealSha256: digest(`${entries.join('\n')}\n`),
    activationAuthorized: false,
    operatorEvidenceReviewed: reviewed,
  };
}
