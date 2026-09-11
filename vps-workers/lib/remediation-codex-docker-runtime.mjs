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
  '/usr/local/libexec/baci-shell-bash',
  '/usr/local/libexec/baci-shell-dash',
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
          'CHOWN',
          '--cap-add',
          'SETUID',
          '--cap-add',
          'SETGID',
        ]
      : [],
    identityArgs: [
      '--tmpfs',
      `/codex-home:rw,nosuid,nodev,size=64m,uid=${uid},gid=${gid},mode=700`,
      '--user',
      `${containerUid}:${containerGid}`,
    ],
    launchShell: readOnly ? '/usr/local/libexec/baci-real-dash' : '/bin/sh',
    launchScript: readOnly
      ? `umask 077; mkdir -p "$CODEX_HOME"; chmod 700 /codex-auth "$CODEX_HOME"; cp /codex-auth/source-auth.json "$CODEX_HOME/auth.json"; chown "$BACI_CODEX_SHELL_UID:$BACI_CODEX_SHELL_GID" "$CODEX_HOME/auth.json"; chmod 400 "$CODEX_HOME/auth.json"; shell_dir="$(mktemp -d /tmp/.baci-shell.XXXXXX)"; chmod 700 "$shell_dir"; cp /usr/local/libexec/.baci-internal/bash "$shell_dir/bash"; cp /usr/local/libexec/.baci-internal/dash "$shell_dir/dash"; chown "$BACI_CODEX_SHELL_UID:$BACI_CODEX_SHELL_GID" "$shell_dir" "$shell_dir/bash" "$shell_dir/dash"; chmod 755 "$shell_dir/bash" "$shell_dir/dash"; export BACI_CODEX_RAW_BASH_PATH="$shell_dir/bash" BACI_CODEX_RAW_DASH_PATH="$shell_dir/dash"; unset BACI_CODEX_SHELL_BOOTSTRAP; exec /usr/local/libexec/baci-real-dash -c 'exec /opt/codex/bin/codex "$@"' -- "$@"`
      : 'umask 077; mkdir -p "$CODEX_HOME"; chmod 700 "$CODEX_HOME"; cp /codex-auth/auth.json "$CODEX_HOME/auth.json"; chmod 600 "$CODEX_HOME/auth.json"; exec /opt/codex/bin/codex "$@"',
  };
}
