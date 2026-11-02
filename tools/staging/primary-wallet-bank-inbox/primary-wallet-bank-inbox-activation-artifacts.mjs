import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

export async function buildPrimaryBankActivationArtifacts({
  packageRoot, inventory, now, effectiveExpiry, reviewed, inventoryBytes,
  databaseBytes, manifest,
}) {
  const actions = {
    purpose: 'Review-only desired changes; no executable apply mode',
    host: inventory.host,
    activationAuthorized: false,
    requiresOwnerApproval: true,
    identity: {
      osAccount: 'baci-primary-bank-inbox',
      noLoginShell: '/usr/sbin/nologin',
      dbLogin: 'baci_primary_bank_worker',
      soleDbGroup: 'primary_bank_inbox_worker',
    },
    install: [
      {
        source: 'sealed package directory',
        target: '/opt/baci/primary-bank-inbox',
        owner: 'root:root',
        directoryMode: '0755',
        artifactFileMode: '0644',
        required:
          'Fresh privileged absence/current-artifact comparison and backup; no overwrite on mismatch. Nonsecret sealed assets must be readable by the worker.',
      },
      {
        source: 'owner secret delivery, not runtime.env.example',
        target: '/etc/baci/primary-bank-inbox.env',
        owner: 'root:root',
        mode: '0600',
        required:
          'Do not print, source in an interactive shell, or package real values',
      },
      {
        source: 'owner approval metadata',
        target: '/opt/baci/primary-bank-inbox/owner-approval.json',
        owner: 'root:baci-primary-bank-inbox',
        mode: '0640',
        required:
          'Nonsecret approval metadata must be worker-readable and root-writable only. Approve exact SHA256SUMS digest, separate install/start/capability/provider/migration/rollback decisions, expiry no later than preparation.',
      },
      {
        source: 'baci-primary-bank-inbox.service',
        target: '/etc/systemd/system/baci-primary-bank-inbox.service',
        owner: 'root:root',
        mode: '0644',
      },
      {
        source: 'baci-primary-bank-inbox.timer',
        target: '/etc/systemd/system/baci-primary-bank-inbox.timer',
        owner: 'root:root',
        mode: '0644',
      },
      {
        source: 'worker-expiry.conf',
        target:
          '/etc/systemd/system/baci-primary-bank-inbox.service.d/10-owner-gates.conf',
        owner: 'root:root',
        mode: '0644',
        required: 'Mandatory expiry and sealed-artifact gate, not optional',
      },
    ],
    prerequisiteProofs: [
      'Privileged migration replay/installed signature + ACL receipt',
      'Exact existing enabled bank inbox authority and merchant/business scope',
      'Sole non-elevated worker membership with no direct table grants',
      'Finite DB credential validity within approval',
      'Verified bank receipt signing keys with approved retention',
      'Quarantine monitoring and restricted operator reconciliation',
      'Outer webhook rotation gate',
    ],
    ownerOnlySequence: [
      [
        'node',
        '/opt/baci/primary-bank-inbox/activation-guard.mjs',
        '--verify',
        '/opt/baci/primary-bank-inbox',
      ],
      [
        'systemd-analyze',
        'verify',
        '/etc/systemd/system/baci-primary-bank-inbox.service',
        '/etc/systemd/system/baci-primary-bank-inbox.timer',
      ],
      ['systemctl', 'daemon-reload'],
      ['systemctl', 'start', 'baci-primary-bank-inbox.service'],
      ['systemctl', 'enable', '--now', 'baci-primary-bank-inbox.timer'],
    ],
    rollbackOwnerOnly: [
      ['systemctl', 'disable', '--now', 'baci-primary-bank-inbox.timer'],
      ['systemctl', 'stop', 'baci-primary-bank-inbox.service'],
    ],
    rollbackPreserves: [
      'All signed inbox receipts, inflow ledger, observations, claims and quarantine',
      'Ordinary wallet cash and principal',
      'Shared card/interest/mobile configuration and DB authority',
    ],
    rollbackArtifactPolicy:
      'After stopping only this worker, restore only exact prior backed-up file hashes/modes or remove only proven newly installed owned files. No blind deletion, inbox purge, role revocation or credential rotation. An applied inflow credit is not reversed by stopping the worker.',
  };
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
        purpose: 'Bank-inbox-only sealed prepare-only activation review',
        createdAt: new Date(now).toISOString(),
        expiresAt: effectiveExpiry,
        activationAuthorized: false,
        operatorEvidenceReviewed: reviewed,
        evidenceClassification: reviewed
          ? 'operator_attestation_not_independently_verified'
          : 'host_metadata_only',
        hostInventorySha256: digest(inventoryBytes),
        databaseInventorySha256: digest(databaseBytes),
        candidateBundleSha256: manifest.artifacts['bank-inbox.cjs'],
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
              'Exact bank authority/scope proof',
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
