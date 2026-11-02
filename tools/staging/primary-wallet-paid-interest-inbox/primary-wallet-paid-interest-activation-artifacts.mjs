import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

export function createPrimaryInterestMonitoringPlan(inventory) {
  return {
    version: 1,
    purpose:
      'Review-only monitoring setup; no credentials, deployment, or alert delivery',
    activationAuthorized: false,
    status: 'blocked_on_operator_and_database_contract',
    suppliedHostInventory: {
      evidenceSource: inventory.evidenceSource ?? 'not_supplied',
      classification:
        'supplied_host_metadata_only_not_database_or_configuration_verification',
      host: inventory.host,
      capturedAt: inventory.capturedAt,
      workerAccountPresent: inventory.accountPresent,
      service: inventory.units?.['baci-primary-paid-interest.service'] ?? {
        LoadState: 'unknown',
      },
      timer: inventory.units?.['baci-primary-paid-interest.timer'] ?? {
        LoadState: 'unknown',
      },
    },
    healthSignals: [
      'Read-only aggregate counts by pending, processing, processed, and quarantined state; never return event IDs, payloads, signatures, tokens, customers, or amounts.',
      'Oldest due pending age and expired processing lease count, computed by the database clock.',
      'Systemd timer ActiveState plus LastTriggerUSec and service Result/ExecMainExitTimestamp; a loaded but inactive timer is unhealthy.',
      'Worker nonzero exit and latest successful poll timestamp; output only bounded aggregate counters and fixed redacted error codes.',
    ],
    proposedDatabaseBoundary: {
      role: 'piggyvest_primary_interest_monitor',
      roleType:
        'NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS',
      function:
        'piggyvest_primary.read_paid_interest_inbox_health(uuid,text,jsonb)',
      allowedData:
        'Aggregate counts and age/lease metrics scoped to one exact integration, environment, and business authority.',
      tablePrivileges:
        'None; function EXECUTE only. No enqueue, claim, finish, readiness mutation, provider API, or financial RPC grants.',
      provisioning:
        'Not implemented. Requires a new append-only migration, isolated login provisioned with sole membership in this role, and local PostgreSQL privilege tests before any live provisioning.',
    },
    alertDelivery: {
      status: 'unconfigured',
      destination: null,
      transport: null,
      existingConfigDisposition:
        'BACI_REMEDIATION_NOTIFY_EMAILS is remediation-report scoped and is not approved or reused for financial alerts.',
      requiredOwnerFacts: [
        'Approved recipient or paging destination and accountable owner.',
        'Approved transport, retry/deduplication behavior, and tested delivery evidence.',
        'Thresholds for oldest pending age, expired leases, quarantine, and missed timer polls.',
        'Acknowledgement, escalation, recovery, and alert-suppression policy.',
      ],
      externalMessagesSent: false,
    },
    offlineSetup: [
      'Keep the current feature and worker approval flags disabled.',
      'Build and inspect this sealed plan with the existing offline activation preparation flow.',
      'Implement and test the separate aggregate-only monitor role/function and host poller before requesting any credentials or delivery setup.',
      'Do not mark the drain-scheduled attestation true until the timer is installed, enabled, and observed running.',
    ],
  };
}

export async function buildPrimaryInterestActivationArtifacts({
  packageRoot,
  inventory,
  now,
  effectiveExpiry,
  reviewed,
  inventoryBytes,
  databaseBytes,
  manifest,
}) {
  const actions = {
    purpose: 'Review-only desired changes; no executable apply mode',
    host: inventory.host,
    activationAuthorized: false,
    requiresOwnerApproval: true,
    identity: {
      osAccount: 'baci-primary-interest-inbox',
      noLoginShell: '/usr/sbin/nologin',
      dbLogin: 'baci_piggyvest_primary_evidence',
      soleDbGroup: 'piggyvest_primary_evidence',
    },
    install: [
      {
        source: 'sealed package directory',
        target: '/opt/baci/primary-paid-interest',
        owner: 'root:root',
        directoryMode: '0755',
        artifactFileMode: '0644',
        required:
          'Fresh privileged absence/current-artifact comparison and backup; no overwrite on mismatch. Nonsecret sealed assets must be readable by the worker.',
      },
      {
        source: 'owner secret delivery, not runtime.env.example',
        target: '/etc/baci/primary-paid-interest.env',
        owner: 'root:root',
        mode: '0600',
        required:
          'Do not print, source in an interactive shell, or package real values',
      },
      {
        source: 'owner approval metadata',
        target: '/opt/baci/primary-paid-interest/owner-approval.json',
        owner: 'root:baci-primary-interest-inbox',
        mode: '0640',
        required:
          'Nonsecret approval metadata must be worker-readable and root-writable only. Approve exact SHA256SUMS digest, separate install/start/capability/provider/migration/rollback decisions, expiry no later than preparation.',
      },
      {
        source: 'baci-primary-paid-interest.service',
        target: '/etc/systemd/system/baci-primary-paid-interest.service',
        owner: 'root:root',
        mode: '0644',
      },
      {
        source: 'baci-primary-paid-interest.timer',
        target: '/etc/systemd/system/baci-primary-paid-interest.timer',
        owner: 'root:root',
        mode: '0644',
      },
      {
        source: 'worker-expiry.conf',
        target:
          '/etc/systemd/system/baci-primary-paid-interest.service.d/10-owner-gates.conf',
        owner: 'root:root',
        mode: '0644',
        required: 'Mandatory expiry and sealed-artifact gate, not optional',
      },
    ],
    prerequisiteProofs: [
      'Privileged migration replay/installed signature + ACL/RLS receipt',
      'Exact existing enabled inflow authority and business scope',
      'Sole non-elevated evidence membership with no direct table grants',
      'Finite DB credential validity within approval; coordinate existing shared evidence login, do not rotate/rebind it here',
      'Provider crosswalk and full-net opted-in plan policy',
      'Quarantine monitoring and restricted operator reconciliation',
      'Old-key retention and outer webhook rotation gate',
    ],
    ownerOnlySequence: [
      [
        'node',
        '/opt/baci/primary-paid-interest/activation-guard.mjs',
        '--verify',
        '/opt/baci/primary-paid-interest',
      ],
      [
        'systemd-analyze',
        'verify',
        '/etc/systemd/system/baci-primary-paid-interest.service',
        '/etc/systemd/system/baci-primary-paid-interest.timer',
      ],
      ['systemctl', 'daemon-reload'],
      ['systemctl', 'start', 'baci-primary-paid-interest.service'],
      ['systemctl', 'enable', '--now', 'baci-primary-paid-interest.timer'],
    ],
    rollbackOwnerOnly: [
      ['systemctl', 'disable', '--now', 'baci-primary-paid-interest.timer'],
      ['systemctl', 'stop', 'baci-primary-paid-interest.service'],
    ],
    rollbackPreserves: [
      'All signed inbox receipts, payout ledger, observations, claims and quarantine',
      'Ordinary wallet cash and principal',
      'Shared bank/card/mobile configuration and DB authority',
    ],
    rollbackArtifactPolicy:
      'After stopping only this worker, restore only exact prior backed-up file hashes/modes or remove only proven newly installed owned files. No blind deletion, inbox purge, role revocation or credential rotation. A committed payout is not refunded by stopping the worker.',
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
    path.join(packageRoot, 'monitoring-plan.review.json'),
    JSON.stringify(createPrimaryInterestMonitoringPlan(inventory), null, 2),
    { mode: 0o600 }
  );
  await writeFile(
    path.join(packageRoot, 'preparation.json'),
    JSON.stringify(
      {
        version: 1,
        purpose: 'Interest-only sealed prepare-only activation review',
        createdAt: new Date(now).toISOString(),
        expiresAt: effectiveExpiry,
        activationAuthorized: false,
        operatorEvidenceReviewed: reviewed,
        evidenceClassification: reviewed
          ? 'operator_attestation_not_independently_verified'
          : 'host_metadata_only',
        hostInventorySha256: digest(inventoryBytes),
        databaseInventorySha256: digest(databaseBytes),
        candidateBundleSha256: manifest.artifacts['interest-inbox.cjs'],
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
              'Exact provider crosswalk/net eligibility proof',
              'Finite credential expiry and shared-login owner coordination',
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
