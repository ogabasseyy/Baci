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
function readRegisteredSuites(
  repositoryRoot: string,
  registryPath: string
): { location: string; value: string }[] {
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
      return { location, value };
    });
}

function readReplaySqlChecks(
  repositoryRoot: string,
  registryPath: string
): string[] {
  return readRegisteredSuites(repositoryRoot, registryPath).map(
    ({ value }) => value
  );
}

/**
 * Replaces `--sql-check-registry <dir>` with the registered `--sql-check`
 * pairs in place, so explicit `--sql-check` flags keep their relative order.
 * A registered suite that is also passed explicitly is rejected, so no suite
 * runs twice. Every other argument passes through for the strict parser.
 */
function expandSqlCheckRegistryArguments(
  argv: readonly string[],
  repositoryRoot: string
): string[] {
  const explicit = new Set(
    argv.filter((_value, index) => argv[index - 1] === '--sql-check')
  );
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
    for (const suite of readRegisteredSuites(repositoryRoot, value)) {
      if (explicit.has(suite.value)) {
        throw replayRegistry.error(
          `${suite.location} lists ${suite.value}, which is also passed as an explicit --sql-check`
        );
      }
      expanded.push('--sql-check', suite.value);
    }
  }
  return expanded;
}

export const replaySqlCheckRegistry = {
  expandArguments: expandSqlCheckRegistryArguments,
  flag: SQL_CHECK_REGISTRY_FLAG,
  readSuites: readReplaySqlChecks,
};
