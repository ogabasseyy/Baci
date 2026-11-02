export function buildPrimaryTransferOwnerActions({ inventory, instance }) {
  return {
    purpose: 'Review-only desired changes; no executable apply mode',
    host: inventory.host,
    instance,
    activationAuthorized: false,
    requiresOwnerApproval: true,
    identity: {
      osAccount: 'baci-primary-card-transfer',
      noLoginShell: '/usr/sbin/nologin',
      dbLogin: 'baci_primary_card_transfer',
      soleDbGroup: 'primary_card_transfer_worker',
    },
    install: [
      {
        source: 'sealed package directory',
        target: '/opt/baci/primary-card-transfer',
        owner: 'root:root',
        directoryMode: '0755',
        artifactFileMode: '0644',
        required:
          'Fresh privileged absence/current-artifact comparison and backup; no overwrite on mismatch. Nonsecret sealed assets must be readable by the worker.',
      },
      {
        source: 'owner secret delivery, not runtime.env.example',
        target: `/etc/baci/primary-card-transfer-${instance}.env`,
        owner: 'root:root',
        mode: '0600',
        required:
          'Do not print, source in an interactive shell, or package real values. Never place custody or intake passwords in the transfer worker environment; the launcher rejects either.',
      },
      {
        source: 'owner approval metadata',
        target: '/opt/baci/primary-card-transfer/owner-approval.json',
        owner: 'root:baci-primary-card-transfer',
        mode: '0640',
        required:
          'Nonsecret approval metadata must be worker-readable and root-writable only. Approve exact SHA256SUMS digest, separate install/start/capability/provider/migration/rollback decisions, expiry no later than preparation.',
      },
      {
        source: 'baci-primary-card-transfer@.service',
        target: '/etc/systemd/system/baci-primary-card-transfer@.service',
        owner: 'root:root',
        mode: '0644',
      },
      {
        source: 'baci-primary-card-transfer@.timer',
        target: '/etc/systemd/system/baci-primary-card-transfer@.timer',
        owner: 'root:root',
        mode: '0644',
      },
      {
        source: 'worker-expiry.conf',
        target: `/etc/systemd/system/baci-primary-card-transfer@${instance}.service.d/10-owner-gates.conf`,
        owner: 'root:root',
        mode: '0644',
        required: 'Mandatory expiry and sealed-artifact gate, not optional',
      },
    ],
    prerequisiteProofs: [
      'Privileged migration replay/installed signature + ACL receipt',
      'Exact enabled transfer authority, treasury policy and binding',
      'Sole non-elevated transfer membership with no direct table grants',
      'Finite DB credential validity within approval',
      'Approved reusable transfer policy, issuer key and exhaustive alias contract',
      'Separately scheduled custody receipt worker with signed proof settlement',
      'Quarantine monitoring and restricted operator reconciliation',
    ],
    ownerOnlySequence: [
      [
        'node',
        '/opt/baci/primary-card-transfer/activation-guard.mjs',
        '--verify',
        '/opt/baci/primary-card-transfer',
      ],
      [
        'systemd-analyze',
        'verify',
        `/etc/systemd/system/baci-primary-card-transfer@${instance}.service`,
        `/etc/systemd/system/baci-primary-card-transfer@${instance}.timer`,
      ],
      ['systemctl', 'daemon-reload'],
      ['systemctl', 'start', `baci-primary-card-transfer@${instance}.service`],
      [
        'systemctl',
        'enable',
        '--now',
        `baci-primary-card-transfer@${instance}.timer`,
      ],
    ],
    rollbackOwnerOnly: [
      [
        'systemctl',
        'disable',
        '--now',
        `baci-primary-card-transfer@${instance}.timer`,
      ],
      ['systemctl', 'stop', `baci-primary-card-transfer@${instance}.service`],
    ],
    rollbackPreserves: [
      'Transfer outbox, operations, reservations, collections and custody proofs',
      'Ordinary wallet cash and principal',
      'Shared bank/interest/mobile configuration and DB authority',
    ],
    rollbackArtifactPolicy:
      'After stopping only this worker, restore only exact prior backed-up file hashes/modes or remove only proven newly installed owned files. No blind deletion, outbox purge, role revocation or credential rotation. A submitted transfer is not recalled by stopping the worker; unknown/dispatching operations stay fenced for signed custody reconciliation.',
  };
}
