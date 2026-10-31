// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

const AGENTIC_ROUTES_DIR = dirname(fileURLToPath(import.meta.url));
const TEST_ONLY_FILE = /\.test\.tsx?$|test-support|test-helpers/;

function listRuntimeSources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = join(dir, entry.name);
    if (entry.isDirectory()) return listRuntimeSources(entryPath);
    return /\.tsx?$/.test(entry.name) && !TEST_ONLY_FILE.test(entry.name)
      ? [entryPath]
      : [];
  });
}

it('keeps the service-role admin client out of user-facing agentic routes', () => {
  const offenders = listRuntimeSources(AGENTIC_ROUTES_DIR)
    .filter((file) =>
      readFileSync(file, 'utf8').includes('@/lib/supabase/admin')
    )
    .map((file) => relative(AGENTIC_ROUTES_DIR, file))
    .sort();

  expect(offenders).toEqual([]);
});
