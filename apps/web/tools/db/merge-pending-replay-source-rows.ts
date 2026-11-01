import { replayRegistry } from './replay-registry';

const ROW = /^[0-9a-f]{64} \d{14}_[a-z0-9_]+\.sql$/;
const filenameOf = (row: string) => row.slice(65);
const byFilename = (left: string, right: string): number => {
  const l = filenameOf(left);
  const r = filenameOf(right);
  if (l < r) return -1;
  if (l > r) return 1;
  return 0;
};

/**
 * The one ordering and de-duplication rule both pending inventories use (the
 * manifest rows and the independent expected inventory), so they can only
 * disagree when their registrations do. Rows are `<sha256> <filename>`:
 * - frozen legacy rows may repeat a migration only with identical bytes
 *   (the legacy expected aggregator spread some blocks twice); those collapse;
 * - a registry row may not re-register a legacy migration, and no migration
 *   may carry two hashes; both fail loudly;
 * - the result is a stable sort by filename in code-unit order.
 */
export function mergePendingReplaySourceRows(
  legacyRows: readonly string[],
  registryRows: readonly string[]
): string[] {
  const hashes = new Map<string, string>();
  const merged: string[] = [];
  for (const row of legacyRows) {
    if (!ROW.test(row)) {
      throw new Error(`Invalid frozen pending replay row: ${row}`);
    }
    const previous = hashes.get(filenameOf(row));
    if (previous === undefined) {
      hashes.set(filenameOf(row), row);
      merged.push(row);
    } else if (previous !== row) {
      throw new Error(
        `${filenameOf(row)} is registered with two different hashes`
      );
    }
  }
  for (const row of registryRows) {
    if (hashes.has(filenameOf(row))) {
      throw replayRegistry.error(
        `${filenameOf(row)} is already registered in the frozen legacy set; remove it from the registry folder`
      );
    }
    merged.push(row);
  }
  return merged.sort(byFilename);
}
