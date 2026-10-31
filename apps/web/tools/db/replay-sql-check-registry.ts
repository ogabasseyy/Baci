import { statSync } from 'node:fs';
import { replayRegistry } from './replay-registry';
import { replayRepository } from './replay-repository-root';

/** CLI flag that expands to one `--sql-check` per registered suite. */
const SQL_CHECK_REGISTRY_FLAG = '--sql-check-registry';
const SUITE_PATH = /^supabase\/(?:tests|migrations\/tests)\/[a-z0-9_]+\.sql$/;

function isFile(filePath: string): boolean {
  try {
    return statSync(filePath).isFile();
  } catch {
    return false;
  }
}

/**
 * Entry suites from every `sql-checks.txt` under `registryPath`, in registry
 * order (sorted folders, then file order). The replay runs them sequentially
 * against one database, so this order is the execution order. `\ir` parts,
 * duplicates, and missing files fail loudly instead of being skipped.
 */
function readReplaySqlChecks(
  repositoryRoot: string,
  registryPath: string
): string[] {
  const directory = replayRepository.path(repositoryRoot, registryPath);
  const registeredAt = new Map<string, string>();
  return replayRegistry
    .readList('sql-checks.txt', directory)
    .map(({ location, value }) => {
      if (value.endsWith('.inc.sql')) {
        throw replayRegistry.error(
          `${location} lists ${value}, an \\ir part; register its entry suite`
        );
      }
      if (!SUITE_PATH.test(value)) {
        throw replayRegistry.error(
          `${location} must be supabase/tests/<name>.sql or supabase/migrations/tests/<name>.sql`
        );
      }
      const previous = registeredAt.get(value);
      if (previous) {
        throw replayRegistry.error(
          `${location} lists ${value} again (first at ${previous})`
        );
      }
      if (!isFile(replayRepository.path(repositoryRoot, value))) {
        throw replayRegistry.error(`${location} lists missing file ${value}`);
      }
      registeredAt.set(value, location);
      return value;
    });
}

/**
 * Replaces `--sql-check-registry <dir>` with the registered `--sql-check`
 * pairs in place, so explicit `--sql-check` flags keep their relative order.
 * Every other argument passes through for the strict replay parser.
 */
function expandSqlCheckRegistryArguments(
  argv: readonly string[],
  repositoryRoot: string
): string[] {
  const expanded: string[] = [];
  let registries = 0;
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag !== SQL_CHECK_REGISTRY_FLAG || value === undefined) {
      expanded.push(...argv.slice(index, index + 2));
      continue;
    }
    registries += 1;
    if (registries > 1) {
      throw replayRegistry.error(`${SQL_CHECK_REGISTRY_FLAG} may appear once`);
    }
    for (const suite of readReplaySqlChecks(repositoryRoot, value)) {
      expanded.push('--sql-check', suite);
    }
  }
  return expanded;
}

export const replaySqlCheckRegistry = {
  expandArguments: expandSqlCheckRegistryArguments,
  flag: SQL_CHECK_REGISTRY_FLAG,
  readSuites: readReplaySqlChecks,
};
