export function buildPrimaryCustodyOwnerActions({ inventory, instance }) {
  return {
    purpose: 'Review-only desired changes; no executable apply mode',
    host: inventory.host,
    instance,
    activationAuthorized: false,
    requiresOwnerApproval: true,
    identity: {
      osAccount: 'baci-primary-card-custody',
      noLoginShell: '/usr/sbin/nologin',
      dbLogin: 'baci_primary_card_custody',
      soleDbGroup: 'primary_card_custody_evidence',
    },
    install: [
      {
        source: 'sealed package directory',
        target: '/opt/baci/primary-card-custody',
        owner: 'root:root',
        directoryMode: '0755',
        artifactFileMode: '0644',
        required:
          'Fresh privileged absence/current-artifact comparison and backup; no overwrite on mismatch. Nonsecret sealed assets must be readable by the worker.',
      },
      {
        source: 'owner secret delivery, not runtime.env.example',
        target: `/etc/baci/primary-card-custody-${instance}.env`,
        owner: 'root:root',
        mode: '0600',
        required:
          'Do not print, source in an interactive shell, or package real values. Never place transfer or intake passwords in the custody worker environment; the launcher rejects either.',
      },
      {
        source: 'owner crosswalk delivery, out of band',
        target: 'PIGGYVEST_PRIMARY_CARD_CROSSWALK_FILE path',
        owner: 'root:worker',
        mode: '0600',
        required:
          'Absolute private regular file, single link, no symlink, maximum 1 MiB, 0600, owned by root or the worker UID. HMAC-signed by the approved issuer delivery key over exact bytes; hash and signature pinned in the environment. Never package the crosswalk inside the sealed bundle.',
      },
      {
        source: 'owner approval metadata',
        target: '/opt/baci/primary-card-custody/owner-approval.json',
        owner: 'root:baci-primary-card-custody',
        mode: '0640',
        required:
          'Nonsecret approval metadata must be worker-readable and root-writable only. Approve exact SHA256SUMS digest, separate install/start/capability/provider/migration/rollback decisions, expiry no later than preparation.',
      },
      {
        source: 'baci-primary-card-custody@.service',
        target: '/etc/systemd/system/baci-primary-card-custody@.service',
        owner: 'root:root',
        mode: '0644',
      },
      {
        source: 'baci-primary-card-custody@.timer',
        target: '/etc/systemd/system/baci-primary-card-custody@.timer',
        owner: 'root:root',
        mode: '0644',
      },
      {
        source: 'worker-expiry.conf',
        target: `/etc/systemd/system/baci-primary-card-custody@${instance}.service.d/10-owner-gates.conf`,
        owner: 'root:root',
        mode: '0644',
        required: 'Mandatory expiry and sealed-artifact gate, not optional',
      },
    ],
    prerequisiteProofs: [
      'Privileged migration replay/installed signature + ACL receipt',
      'Exact enabled custody authority, inbox capability and treasury policy',
      'Sole non-elevated custody membership with no direct table grants',
      'Finite DB credential validity within approval',
      'Approved authenticated crosswalk file, issuer key and exhaustive alias evidence',
      'Separately scheduled financial transfer worker with fenced one-attempt dispatch',
      'Quarantine monitoring and restricted operator reconciliation',
    ],
    ownerOnlySequence: [
      [
        'node',
        '/opt/baci/primary-card-custody/activation-guard.mjs',
        '--verify',
        '/opt/baci/primary-card-custody',
      ],
      [
        'systemd-analyze',
        'verify',
        `/etc/systemd/system/baci-primary-card-custody@${instance}.service`,
        `/etc/systemd/system/baci-primary-card-custody@${instance}.timer`,
      ],
      ['systemctl', 'daemon-reload'],
      ['systemctl', 'start', `baci-primary-card-custody@${instance}.service`],
      [
        'systemctl',
        'enable',
        '--now',
        `baci-primary-card-custody@${instance}.timer`,
      ],
    ],
    rollbackOwnerOnly: [
      [
        'systemctl',
        'disable',
        '--now',
        `baci-primary-card-custody@${instance}.timer`,
      ],
      ['systemctl', 'stop', `baci-primary-card-custody@${instance}.service`],
    ],
    rollbackPreserves: [
      'Signed inbox receipts, custody proofs, settlement ledger and observations',
      'Ordinary wallet cash and principal',
      'Shared bank/interest/mobile configuration and DB authority',
    ],
    rollbackArtifactPolicy:
      'After stopping only this worker, restore only exact prior backed-up file hashes/modes or remove only proven newly installed owned files. No blind deletion, inbox purge, role revocation or credential rotation. A settled custody credit is not reversed by stopping the worker.',
  };
}
