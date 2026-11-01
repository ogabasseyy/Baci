import { spawnSync } from 'node:child_process';

export function resolvePostgresBin({
  args = process.argv,
  env = process.env,
  run = spawnSync,
} = {}) {
  const explicit = args
    .find((arg) => arg.startsWith('--postgres-bin='))
    ?.slice('--postgres-bin='.length);
  if (explicit) return explicit;
  if (env.PG_BINDIR?.trim()) return env.PG_BINDIR.trim();
  const result = run('pg_config', ['--bindir'], {
    encoding: 'utf8',
    timeout: 5000,
  });
  return result.status === 0 && typeof result.stdout === 'string'
    ? result.stdout.trim()
    : '';
}
