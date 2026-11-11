import { readFileSync } from 'node:fs';
import { dirname, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const scriptsDirectory = resolve(repoRoot, '.github/scripts');
const ciWorkflow = readFileSync(resolve(repoRoot, '.github/workflows/ci.yml'), 'utf8');
const deployFilters = readFileSync(resolve(repoRoot, '.github/filters/deploy.yml'), 'utf8');
const DEPLOY_WEB_FILTER_REGEX = /^web:\n(?<body>(?:\s{2}- .+\n)+)/m;

// Matches `from './x.mjs'`, side-effect `import './x.mjs'` and dynamic `import('./x.mjs')`, in
// single or double quotes, with optional subdirectories and `../` parents.
const RELATIVE_MODULE_IMPORT =
  /(?:\bfrom\s*|\bimport\s*\(?\s*)(['"])(\.{1,2}\/[\w./-]+\.mjs)\1/g;

function collectRelativeModuleImports(source: string): string[] {
  return [...source.matchAll(RELATIVE_MODULE_IMPORT)].flatMap((match) =>
    match[2] ? [match[2]] : []
  );
}

function getDeployWebFilter(): string {
  const body = deployFilters.match(DEPLOY_WEB_FILTER_REGEX)?.groups?.body;
  if (!body) throw new Error('.github/filters/deploy.yml must define a web filter');
  return body;
}

describe('storefront release-coherence deploy contract', () => {
  it('finds relative .mjs imports in every import form the contract must cover', () => {
    expect(
      collectRelativeModuleImports(
        [
          "import a from './a.mjs';",
          'import { b } from "./b.mjs";',
          "import './c.mjs';",
          "const d = await import('./sub/d.mjs');",
          'export * from "../e.mjs";',
          "import fs from 'node:fs';",
          "import local from './not-a-module.json';",
        ].join('\n')
      )
    ).toEqual(['./a.mjs', './b.mjs', './c.mjs', './sub/d.mjs', '../e.mjs']);
  });

  it('deploys and tests every transitive import of the release-coherence script', () => {
    const deployWebFilter = getDeployWebFilter();
    const globs = [...deployWebFilter.matchAll(/- '([^']+)\/\*\*'/g)].flatMap((match) =>
      match[1] ? [match[1]] : []
    );
    const pending = ['storefront-release-coherence.mjs'];
    const reached = new Set<string>();
    for (let name = pending.pop(); name !== undefined; name = pending.pop()) {
      if (reached.has(name)) continue;
      reached.add(name);
      const source = readFileSync(resolve(scriptsDirectory, name), 'utf8');
      for (const specifier of collectRelativeModuleImports(source)) {
        // Resolve relative to the importing file, keeping paths relative to .github/scripts.
        pending.push(posix.join(posix.dirname(name), specifier));
      }
    }

    // A dependency missing from the deploy filter would let a change to it skip the production deploy.
    expect(reached).toContain('storefront-release-coherence-escalation.mjs');
    expect(reached).toContain('storefront-release-coherence-canary-urls.mjs');
    for (const name of reached) {
      // Imports may leave .github/scripts (e.g. ../../apps/web/...), so compare repo-relative paths.
      const repoPath = posix.join('.github/scripts', name);
      const coveredByGlob = globs.some((glob) => repoPath.startsWith(`${glob}/`));
      expect(
        deployWebFilter.includes(`- '${repoPath}'`) || coveredByGlob,
        `${repoPath} must be listed in (or covered by) the deploy filter`
      ).toBe(true);
    }
  });

  it('runs every release-coherence and purge test file in the CI deploy-scripts step', () => {
    for (const testFile of [
      'storefront-release-coherence.test.mjs',
      'storefront-release-coherence-escalation.test.mjs',
      'storefront-release-coherence-escalation-safety.test.mjs',
      'storefront-release-coherence-host-purge.test.mjs',
      'storefront-release-coherence-warming.test.mjs',
      'storefront-release-config.test.mjs',
      'storefront-release-marker.test.mjs',
      'storefront-sitemap-purge.test.mjs',
      'cloudflare-purge-cache.test.mjs',
    ]) {
      expect(ciWorkflow).toContain(`.github/scripts/${testFile}`);
    }
  });
});
