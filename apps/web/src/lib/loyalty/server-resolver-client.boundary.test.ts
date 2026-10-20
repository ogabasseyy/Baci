import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sourceRoot = resolve(process.cwd(), 'src');

function productionTypeScriptFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return productionTypeScriptFiles(path);
    const isTestFile =
      /\.test([.-]|$)/.test(entry.name) || /\.spec\.[jt]sx?$/.test(entry.name);
    return /\.tsx?$/.test(entry.name) && !isTestFile ? [path] : [];
  });
}

describe('loyalty resolver service-role boundary', () => {
  it('allows only the two approved call graphs to import the resolver edge', () => {
    // Match real import specifiers: an import/from/require keyword must
    // open the string, so governance allowlists holding the bare path
    // (no import keyword) do not count — while an explicit extension
    // spelling (@/.../server-resolver-client.ts) still matches.
    const edgeImportPattern =
      /(?:import|from|require)\s*\(?\s*['"`][^'"`]*loyalty\/server-resolver-client(\.(ts|tsx|js|mts|cts))?['"`]/;
    const importers = productionTypeScriptFiles(sourceRoot)
      .filter((path) => edgeImportPattern.test(readFileSync(path, 'utf8')))
      .map((path) => relative(sourceRoot, path));

    expect(importers).toEqual([
      'app/api/storefront/discount/validate/route.ts',
      'lib/checkout/resolve-loyalty-checkout-code.ts',
    ]);
  });

  it('allows only the wrapper to construct the loyalty-resolver brand', () => {
    // Match constructions, not mentions: the brand string also appears
    // in the service-client definition and the event-pipeline governance
    // allowlist, which must not count as constructor sites.
    const constructionPattern =
      /createServiceClient\(\s*['"`]loyalty-resolver['"`]\)/;
    const constructors = productionTypeScriptFiles(sourceRoot)
      .filter((path) => constructionPattern.test(readFileSync(path, 'utf8')))
      .map((path) => relative(sourceRoot, path));

    expect(constructors).toEqual(['lib/loyalty/server-resolver-client.ts']);
  });
});
