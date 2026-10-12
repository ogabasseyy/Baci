import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sourceRoot = resolve(process.cwd(), 'src');

function productionTypeScriptFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return productionTypeScriptFiles(path);
    // Test files take several spellings: *.test.ts, *.spec.ts, and support
    // modules such as *.test-helpers.ts / *.test-support.ts / *.test-fixture.ts.
    const isTestFile =
      /\.test([.-]|$)/.test(entry.name) || /\.spec\.[jt]sx?$/.test(entry.name);
    return /\.tsx?$/.test(entry.name) && !isTestFile ? [path] : [];
  });
}

describe('search analytics service-role boundary', () => {
  it('allows only the submissions route to import the ingestion edge', () => {
    // Match real import specifiers: an import/from/require keyword must
    // open the string, so governance allowlists holding the bare path
    // (no import keyword) do not count — while an explicit extension
    // spelling (@/.../server-analytics-client.ts) still matches.
    const edgeImportPattern =
      /(?:import|from|require)\s*\(?\s*['"`][^'"`]*server-analytics-client(\.(ts|tsx|js|mts|cts))?['"`]/;
    const importers = productionTypeScriptFiles(sourceRoot)
      .filter((path) => edgeImportPattern.test(readFileSync(path, 'utf8')))
      .map((path) => relative(sourceRoot, path));

    expect(importers).toEqual(['app/api/search/submissions/route.ts']);
  });

  it('allows only the wrapper to construct the search-analytics brand', () => {
    // Match constructions, not mentions: the brand string also appears
    // in the service-client definition and the event-pipeline governance
    // allowlist, which must not count as constructor sites.
    const constructionPattern =
      /createServiceClient\(\s*['"`]search-analytics['"`]\)/;
    const constructors = productionTypeScriptFiles(sourceRoot)
      .filter((path) => constructionPattern.test(readFileSync(path, 'utf8')))
      .map((path) => relative(sourceRoot, path));

    expect(constructors).toEqual(['lib/search/server-analytics-client.ts']);
  });

  it('forbids variable-sentinel constructions everywhere', () => {
    // A non-literal first argument (identifier, template interpolation,
    // member access) would evade the literal-construction pin above, so
    // no production file may construct the factory that way. The factory
    // definition itself is excluded: its implementation signature is not
    // a call site.
    const variableConstructionPattern = /createServiceClient\(\s*(?![)'"'])/;
    const offenders = productionTypeScriptFiles(sourceRoot)
      .filter(
        (path) =>
          relative(sourceRoot, path) !==
            join('lib', 'supabase', 'service.ts') &&
          variableConstructionPattern.test(readFileSync(path, 'utf8'))
      )
      .map((path) => relative(sourceRoot, path));

    expect(offenders).toEqual([]);
  });
});
