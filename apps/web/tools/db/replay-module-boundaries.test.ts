import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const workspaceRoot = path.resolve(import.meta.dirname, '../../../..');
const task3Paths = [
  'apps/web/tools/db/run-replay-command.ts',
  'apps/web/tools/db/run-replay-command.test.ts',
  'apps/web/tools/db/supabase-replay-contract.ts',
  'apps/web/tools/db/supabase-replay-contract.test.ts',
  'apps/web/tools/db/replay-repository-root.ts',
  'apps/web/tools/db/replay-repository-root.test.ts',
  'apps/web/tools/db/allocate-supabase-replay-ports.ts',
  'apps/web/tools/db/allocate-supabase-replay-ports.test.ts',
  'apps/web/tools/db/apply-supabase-replay-sql.ts',
  'apps/web/tools/db/apply-supabase-replay-sql.test.ts',
  'apps/web/tools/db/create-supabase-replay-project-id.ts',
  'apps/web/tools/db/create-supabase-replay-project-id.test.ts',
  'apps/web/tools/db/rewrite-supabase-replay-config.ts',
  'apps/web/tools/db/rewrite-supabase-replay-config.test.ts',
  'apps/web/tools/db/replay-project-ownership.ts',
  'apps/web/tools/db/replay-project-ownership.test.ts',
  'apps/web/tools/db/supabase-replay-expected-resources.ts',
  'apps/web/tools/db/supabase-replay-expected-resources.test.ts',
  'apps/web/tools/db/supabase-replay-resource-inspection.test.ts',
  'apps/web/tools/db/parse-supabase-migration-list.ts',
  'apps/web/tools/db/parse-supabase-migration-list.test.ts',
  'apps/web/tools/db/schemas/linked-migration-ledger-schema.ts',
  'apps/web/tools/db/schemas/linked-migration-ledger-schema.test.ts',
  'apps/web/tools/db/schemas/production-history-effects-schema.ts',
  'apps/web/tools/db/schemas/production-history-effects-schema.test.ts',
  'apps/web/tools/db/schemas/github-migration-semantic-lines-schema.ts',
  'apps/web/tools/db/schemas/github-migration-semantic-lines-schema.test.ts',
  'apps/web/tools/db/schemas/supabase-history-effect-snapshot-schema.ts',
  'apps/web/tools/db/schemas/supabase-history-effect-snapshot-schema.test.ts',
  'apps/web/tools/db/canonical-json-value.ts',
  'apps/web/tools/db/canonical-json-value.test.ts',
  'apps/web/tools/db/canonical-replay-fixture-json.ts',
  'apps/web/tools/db/canonical-replay-fixture-json.test.ts',
  'apps/web/tools/db/canonical-replay-effect-json.ts',
  'apps/web/tools/db/canonical-replay-effect-json.test.ts',
  'apps/web/tools/db/capture-supabase-history-ledger.ts',
  'apps/web/tools/db/capture-supabase-history-ledger.test.ts',
  'apps/web/tools/db/extract-github-migration-semantic-lines.ts',
  'apps/web/tools/db/extract-github-migration-semantic-lines.test.ts',
  'apps/web/tools/db/parse-github-migration-job-log.ts',
  'apps/web/tools/db/parse-github-migration-job-log.test.ts',
  'apps/web/tools/db/capture-production-effect-provenance.ts',
  'apps/web/tools/db/capture-production-effect-provenance.test.ts',
  'apps/web/tools/db/materialize-supabase-history-replay.ts',
  'apps/web/tools/db/materialize-supabase-history-replay.test.ts',
  'apps/web/tools/db/read-supabase-history-effects.ts',
  'apps/web/tools/db/read-supabase-history-effects.test.ts',
  'apps/web/tools/db/supabase-history-effects.sql',
  'apps/web/tools/db/supabase-history-effects.test.ts',
  'apps/web/tools/db/replay-module-boundaries.test.ts',
  'apps/web/tools/db/fixtures/biome.json',
  'apps/web/tools/db/fixtures/github-migration-semantic-lines.json',
  'apps/web/tools/db/fixtures/linked-migration-ledger.json',
  'apps/web/tools/db/fixtures/production-history-effects.json',
  'apps/web/tools/db/run-supabase-history-replay.ts',
  'apps/web/tools/db/run-supabase-history-replay.test.ts',
  'apps/web/tsconfig.tools-workers.json',
  'apps/web/package.json',
] as const;
const task3ManifestSha256 =
  '93c336191bf54b7d0f454f7d3c6559cb8f99b17a8f1426f699f2897508fb2fd4';

const task3FixtureConfigPaths = [
  'apps/web/tools/db/fixtures/biome.json',
  'apps/web/tools/db/fixtures/github-migration-semantic-lines.json',
  'apps/web/tools/db/fixtures/linked-migration-ledger.json',
  'apps/web/tools/db/fixtures/production-history-effects.json',
  'apps/web/tsconfig.tools-workers.json',
  'apps/web/package.json',
] as const;

function isEligibleTask3Path(filePath: string): boolean {
  return (
    /^apps\/web\/tools\/db\/.*\.ts$/.test(filePath) ||
    filePath === 'apps/web/tools/db/supabase-history-effects.sql' ||
    /^apps\/web\/tools\/db\/fixtures\/.*\.json$/.test(filePath) ||
    filePath === 'apps/web/tsconfig.tools-workers.json' ||
    filePath === 'apps/web/package.json'
  );
}

function physicalLineCount(filePath: string): number {
  const body = readFileSync(path.join(workspaceRoot, filePath), 'utf8');
  if (body.length === 0) return 0;
  return body.endsWith('\n')
    ? body.split('\n').length - 1
    : body.split('\n').length;
}

describe('Task 3 replay module boundaries', () => {
  it('does not depend on mutable git working-tree state', () => {
    const body = readFileSync(import.meta.filename, 'utf8');

    expect(body).not.toMatch(/execFileSync\(\s*'git'/);
  });

  it('validates the deterministic checked Task 3 manifest directly', () => {
    const missing = task3Paths.filter(
      (filePath) => !existsSync(path.join(workspaceRoot, filePath))
    );

    expect(task3Paths).toHaveLength(58);
    expect(new Set(task3Paths).size).toBe(58);
    expect(
      createHash('sha256')
        .update(`${task3Paths.join('\n')}\n`)
        .digest('hex')
    ).toBe(task3ManifestSha256);
    expect(
      task3Paths.filter((filePath) => !isEligibleTask3Path(filePath))
    ).toEqual([]);
    expect(
      task3Paths.filter((filePath) => filePath.endsWith('.json')).sort()
    ).toEqual([...task3FixtureConfigPaths].sort());
    expect(task3Paths.filter((filePath) => filePath.endsWith('.sql'))).toEqual([
      'apps/web/tools/db/supabase-history-effects.sql',
    ]);
    expect(missing).toEqual([]);
  });

  it('keeps every checked TypeScript, SQL, and JSON file within 300 lines', () => {
    const missing = task3Paths.filter(
      (filePath) => !existsSync(path.join(workspaceRoot, filePath))
    );
    const oversized = task3Paths
      .filter((filePath) => !missing.includes(filePath))
      .map((filePath) => [filePath, physicalLineCount(filePath)] as const)
      .filter(([, lineCount]) => lineCount > 300);

    expect(missing).toEqual([]);
    expect(oversized).toEqual([]);
  });
});
