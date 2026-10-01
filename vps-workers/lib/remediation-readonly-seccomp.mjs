import { existsSync, lstatSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_READ_ONLY_SECCOMP_PROFILE = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'config/codex-readonly-seccomp.json'
);

export function readOnlyDockerSecurityArgs(env) {
  const profilePath =
    env.BACI_CODEX_READONLY_SECCOMP_PROFILE ||
    DEFAULT_READ_ONLY_SECCOMP_PROFILE;
  if (!isAbsolute(profilePath)) {
    throw new Error(
      'BACI_CODEX_READONLY_SECCOMP_PROFILE must be an absolute path'
    );
  }
  if (!existsSync(profilePath) || !lstatSync(profilePath).isFile()) {
    throw new Error(
      'BACI_CODEX_READONLY_SECCOMP_PROFILE must reference a regular file'
    );
  }
  return ['--security-opt', `seccomp=${profilePath}`];
}
