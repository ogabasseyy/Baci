import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const workspaceRoot = path.resolve(import.meta.dirname, '../../../..');
const task4Paths = [
  'apps/web/tools/db/read-supabase-history-effects.ts',
  'apps/web/tools/db/read-supabase-history-effects.test.ts',
  'apps/web/tools/db/read-supabase-history-effects-comparison.test.ts',
  'apps/web/tools/db/compare-supabase-history-effect-digests.ts',
  'apps/web/tools/db/compare-supabase-history-effect-digests.test.ts',
  'apps/web/tools/db/summarize-supabase-history-effects.ts',
  'apps/web/tools/db/summarize-supabase-history-effects.test.ts',
  'apps/web/tools/db/schemas/production-history-effects-schema.ts',
  'apps/web/tools/db/schemas/production-history-effects-schema.test.ts',
  'apps/web/tools/db/capture-supabase-history-ledger.ts',
  'apps/web/tools/db/capture-supabase-history-ledger.test.ts',
  'apps/web/tools/db/capture-supabase-history-ledger-boundaries.test.ts',
  'apps/web/tools/db/parse-supabase-history-capture-arguments.ts',
  'apps/web/tools/db/parse-supabase-history-capture-arguments.test.ts',
  'apps/web/tools/db/persist-supabase-history-fixtures.ts',
  'apps/web/tools/db/persist-supabase-history-fixtures.test.ts',
  'apps/web/tools/db/run-replay-command.ts',
  'apps/web/tools/db/supabase-replay-command-diagnostic.ts',
  'apps/web/tools/db/run-replay-command.test.ts',
  'apps/web/tools/db/supabase-replay-command-diagnostic.test.ts',
  'apps/web/tools/db/run-replay-command-effects.test.ts',
  'apps/web/tools/db/run-supabase-history-replay.ts',
  'apps/web/tools/db/run-supabase-history-replay.test.ts',
  'apps/web/tools/db/run-supabase-history-replay-effects.test.ts',
  'apps/web/tools/db/run-supabase-history-replay-test-runtime.ts',
  'apps/web/tools/db/run-supabase-history-replay-test-runtime.test.ts',
  'apps/web/tools/db/execute-supabase-history-replay-verification.ts',
  'apps/web/tools/db/execute-supabase-history-replay-verification.test.ts',
  'apps/web/tools/db/supabase-replay-contract.ts',
  'apps/web/tools/db/supabase-replay-contract.test.ts',
  'apps/web/tools/db/supabase-history-replay-types.ts',
  'apps/web/tools/db/supabase-history-effect-query-contract.ts',
  'apps/web/tools/db/supabase-history-effect-query-contract.test.ts',
  'apps/web/tools/db/supabase-history-effect-test-fixture.ts',
  'apps/web/tools/db/supabase-history-effect-test-fixture.test.ts',
  'apps/web/tools/db/task4-replay-effect-boundaries.test.ts',
] as const;
const task4ManifestSha256 =
  'f75d0f53b369cd9a4c60017aa03e55d5d5b88006279b996a3c1ea65fb3453950';

function physicalLineCount(filePath: string): number {
  const body = readFileSync(path.join(workspaceRoot, filePath), 'utf8');
  if (body.length === 0) return 0;
  return body.endsWith('\n')
    ? body.split('\n').length - 1
    : body.split('\n').length;
}

describe('Task 4 replay effect module boundaries', () => {
  it('does not depend on mutable git working-tree state', () => {
    const body = readFileSync(import.meta.filename, 'utf8');

    expect(body).not.toMatch(/execFileSync\(\s*'git'/);
  });

  it('validates the exact reviewed Task 4 manifest directly', () => {
    const missing = task4Paths.filter(
      (filePath) => !existsSync(path.join(workspaceRoot, filePath))
    );

    expect(task4Paths).toHaveLength(36);
    expect(new Set(task4Paths).size).toBe(36);
    expect(
      createHash('sha256')
        .update(`${task4Paths.join('\n')}\n`)
        .digest('hex')
    ).toBe(task4ManifestSha256);
    expect(task4Paths.every((filePath) => filePath.endsWith('.ts'))).toBe(true);
    expect(missing).toEqual([]);
  });

  it('keeps every reviewed Task 4 source, test, and helper within 300 lines', () => {
    const missing = task4Paths.filter(
      (filePath) => !existsSync(path.join(workspaceRoot, filePath))
    );
    const oversized = task4Paths
      .filter((filePath) => !missing.includes(filePath))
      .map((filePath) => [filePath, physicalLineCount(filePath)] as const)
      .filter(([, lineCount]) => lineCount > 300);

    expect(missing).toEqual([]);
    expect(oversized).toEqual([]);
  });
});
