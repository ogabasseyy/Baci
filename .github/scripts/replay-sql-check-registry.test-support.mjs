import { existsSync, readdirSync, readFileSync } from 'node:fs';

// Workflow contract tests assert that CI's DB Replay step runs a suite. The
// step expands this registry (apps/web/tools/db/replay-sql-check-registry.ts
// validates it strictly); these helpers only read which suites are listed.
export const REPLAY_SQL_CHECK_REGISTRY_ARGUMENT =
  '--sql-check-registry apps/web/tools/db/replay-registry';

const REGISTRY = new URL(
  '../../apps/web/tools/db/replay-registry/',
  import.meta.url
);

/** Registered replay SQL suites in execution (sorted folder) order. */
export function readRegisteredReplaySqlChecks() {
  return readdirSync(REGISTRY, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .map((folder) => new URL(`${folder}/sql-checks.txt`, REGISTRY))
    .filter((list) => existsSync(list))
    .flatMap((list) => readFileSync(list, 'utf8').split('\n'))
    .filter((line) => line.length > 0 && !line.startsWith('#'));
}
