import { spawnSync } from 'node:child_process';
import { privateQualificationCommands } from './commands.mjs';
import { localExperienceSqlEnv } from './local-env.mjs';
export function qualifyPrivateExperience() {
  const env = localExperienceSqlEnv();
  for (const [command, args] of privateQualificationCommands()) {
    const r = spawnSync(command, args, {
      env,
      stdio: 'inherit',
      timeout: 600000,
    });
    if (r.status !== 0) return r.status ?? 1;
  }
  return 0;
}
if (process.argv[1]?.endsWith('/experience-sql/qualify-private.mjs'))
  process.exitCode = qualifyPrivateExperience();
