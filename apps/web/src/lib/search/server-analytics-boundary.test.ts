import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sourceRoot = resolve(process.cwd(), 'src');

function productionTypeScriptFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return productionTypeScriptFiles(path);
    return /\.tsx?$/.test(entry.name) && !entry.name.includes('.test.')
      ? [path]
      : [];
  });
}

describe('search analytics service-role boundary', () => {
  it('allows only the submissions route to import the ingestion edge', () => {
    const importers = productionTypeScriptFiles(sourceRoot)
      .filter((path) =>
        readFileSync(path, 'utf8').includes(
          "from '@/lib/search/server-analytics-client'"
        )
      )
      .map((path) => relative(sourceRoot, path));

    expect(importers).toEqual(['app/api/search/submissions/route.ts']);
  });

  it('allows only the wrapper to construct the search-analytics brand', () => {
    const constructors = productionTypeScriptFiles(sourceRoot)
      .filter((path) => {
        const source = readFileSync(path, 'utf8');
        return (
          source.includes("'search-analytics'") &&
          !path.endsWith('lib/supabase/service.ts')
        );
      })
      .map((path) => relative(sourceRoot, path));

    expect(constructors).toEqual(['lib/search/server-analytics-client.ts']);
  });
});
