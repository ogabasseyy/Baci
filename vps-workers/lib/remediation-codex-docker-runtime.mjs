import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CODEX_SHELL_WRAPPER = fileURLToPath(
  new URL('./remediation-codex-shell-wrapper.mjs', import.meta.url)
);
const CODEX_SHELL_PATHS = [
  '/bin/bash',
  '/usr/bin/bash',
  '/bin/sh',
  '/usr/bin/sh',
  '/bin/dash',
  '/usr/bin/dash',
  '/usr/local/libexec/baci-real-bash',
  '/usr/local/libexec/baci-real-dash',
];

function bindMount(source, destination, { readonly = false } = {}) {
  return `type=bind,src=${source},dst=${destination}${readonly ? ',readonly' : ''}`;
}

export function buildCodexDockerRuntime({ codexHome, gid, readOnly, uid }) {
  if (
    readOnly &&
    (!Number.isSafeInteger(uid) ||
      uid <= 0 ||
      !Number.isSafeInteger(gid) ||
      gid <= 0)
  ) {
    throw new Error(
      'read-only Codex runtime requires a non-root worker identity'
    );
  }
  const containerGid = readOnly ? 0 : gid;
  const containerUid = readOnly ? 0 : uid;
  return {
    authArgs: [
      ...(readOnly
        ? ['--tmpfs', '/codex-auth:rw,nosuid,nodev,size=1m,mode=700']
        : []),
      '--env',
      'CODEX_HOME=/codex-home',
      ...(readOnly
        ? [
            '--env',
            `BACI_CODEX_SHELL_UID=${uid}`,
            '--env',
            `BACI_CODEX_SHELL_GID=${gid}`,
            '--env',
            'BACI_CODEX_SHELL_BOOTSTRAP=1',
          ]
        : []),
      ...(readOnly
        ? CODEX_SHELL_PATHS.flatMap((destination) => [
            '--mount',
            bindMount(CODEX_SHELL_WRAPPER, destination, { readonly: true }),
          ])
        : []),
      '--mount',
      bindMount(
        join(codexHome, 'auth.json'),
        readOnly ? '/codex-auth/source-auth.json' : '/codex-auth/auth.json',
        { readonly: true }
      ),
    ],
    capabilityArgs: readOnly
      ? [
          '--cap-add',
          'DAC_OVERRIDE',
          '--cap-add',
          'DAC_READ_SEARCH',
          '--cap-add',
          'SETUID',
          '--cap-add',
          'SETGID',
        ]
      : [],
    identityArgs: [
      '--tmpfs',
      `/codex-home:rw,nosuid,nodev,size=64m,uid=${containerUid},gid=${containerGid},mode=700`,
      '--user',
      `${containerUid}:${containerGid}`,
    ],
    launchShell: '/usr/local/libexec/baci-real-dash',
    launchScript: readOnly
      ? 'umask 077; mkdir -p "$CODEX_HOME"; chmod 700 /codex-auth "$CODEX_HOME"; cp /codex-auth/source-auth.json "$CODEX_HOME/auth.json"; chmod 400 "$CODEX_HOME/auth.json"; unset BACI_CODEX_SHELL_BOOTSTRAP; exec /opt/codex/bin/codex "$@"'
      : 'umask 077; mkdir -p "$CODEX_HOME"; chmod 700 "$CODEX_HOME"; cp /codex-auth/auth.json "$CODEX_HOME/auth.json"; chmod 600 "$CODEX_HOME/auth.json"; exec /opt/codex/bin/codex "$@"',
  };
}
