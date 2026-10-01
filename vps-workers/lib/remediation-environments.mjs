const CHILD_ENV_ALLOWLIST = new Set([
  'CI',
  'CODEX_HOME',
  'HOME',
  'LANG',
  'LC_ALL',
  'LOGNAME',
  'PATH',
  'SHELL',
  'TEMP',
  'TMP',
  'TMPDIR',
  'USER',
  'XDG_CONFIG_HOME',
]);

const GIT_AUTH_ENV_ALLOWLIST = new Set([
  'GH_TOKEN',
  'GITHUB_TOKEN',
  'GIT_ASKPASS',
  'GIT_SSH_COMMAND',
  'SSH_AUTH_SOCK',
]);

const GIT_IDENTITY_ENV_ALLOWLIST = new Set([
  'GIT_AUTHOR_EMAIL',
  'GIT_AUTHOR_NAME',
  'GIT_COMMITTER_EMAIL',
  'GIT_COMMITTER_NAME',
]);

function allowedEntries(environment, allowlist) {
  return Object.entries(environment).filter(
    ([key, value]) => allowlist.has(key) && typeof value === 'string'
  );
}

export function buildRemediationEnvironments(commandEnvironment) {
  const child = Object.fromEntries(
    allowedEntries(commandEnvironment, CHILD_ENV_ALLOWLIST)
  );
  const gitIdentity = {
    ...child,
    ...Object.fromEntries(
      allowedEntries(commandEnvironment, GIT_IDENTITY_ENV_ALLOWLIST)
    ),
  };
  const gitRemote = {
    ...gitIdentity,
    ...Object.fromEntries(
      allowedEntries(commandEnvironment, GIT_AUTH_ENV_ALLOWLIST)
    ),
  };
  return { child, gitIdentity, gitRemote };
}
