import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

const migration = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../../supabase/migrations/20261103025419_piggyvest_deposits_ledger_only.sql'
);
it('uses wildcard selects only to hydrate local row variables, never to return rows', () => {
  const sql = readFileSync(migration, 'utf8')
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');
  const wildcards = [...sql.matchAll(/select\s+(?:\w+\.)?\*[^;]*;/gi)].map(
    (m) => m[0]
  );
  expect(wildcards.length).toBeGreaterThan(0);
  for (const statement of wildcards) {
    expect(statement).toMatch(/\binto\s+(?:strict\s+)?\w+/i);
  }
  expect(sql).not.toMatch(/returning\s+\*/i);
  expect(sql).not.toMatch(/return\s+query\s+select\s+(?:\w+\.)?\*/i);
});
