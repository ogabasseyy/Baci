import { existsSync } from 'node:fs';
/** Disposable local DB only; never reads a hosted DATABASE_URL. */
export function localExperienceSqlEnv() {
  const env = {
    ...Object.fromEntries(
      [
        'PATH',
        'HOME',
        'LANG',
        'TMPDIR',
        'SHELL',
        'TERM',
        'BACI_BUILDER_LOCAL_PG_BIN',
      ]
        .filter((key) => process.env[key])
        .map((key) => [key, process.env[key]])
    ),
    BACI_BUILDER_LOCAL_PG: '1',
    BACI_BUILDER_LOCAL_PG_MAJOR: '17',
  };
  if (
    !env.BACI_BUILDER_LOCAL_PG_BIN &&
    existsSync('/opt/homebrew/opt/postgresql@17/bin/postgres')
  )
    env.BACI_BUILDER_LOCAL_PG_BIN = '/opt/homebrew/opt/postgresql@17/bin';
  return env;
}
