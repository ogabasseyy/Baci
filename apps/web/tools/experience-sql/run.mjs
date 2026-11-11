import { spawnSync } from 'node:child_process';
import { experienceSqlCommands } from './commands.mjs';
import { localExperienceSqlEnv } from './local-env.mjs';
export function runSqlQualification(requested = []) {
  const env = localExperienceSqlEnv();
  for (const [command, args] of experienceSqlCommands(requested)) {
    const r = spawnSync(command, args, {
      env,
      stdio: 'inherit',
      timeout: 120000,
    });
    if (r.status !== 0) return r.status ?? 1;
  }
  return 0;
}
if (process.argv[1]?.endsWith('/experience-sql/run.mjs'))
  process.exitCode = runSqlQualification(
    process.argv.slice(2).filter((v) => v !== '--')
  );
