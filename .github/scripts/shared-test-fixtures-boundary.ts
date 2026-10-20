import { lstatSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';

// Single source of truth for the shared test-fixtures import boundary,
// consumed by the web Vitest guard and both mobile guards (Jest and
// Vitest). Production (non-test) code must never import
// @baci/shared/test-fixtures/* — by subpath specifier, deep-relative
// path (including nested/dotted fixture paths), or through a
// test-named helper file.
//
// Semantics:
// - Fixture patterns apply to every scanned file except true test
//   files and the fixture definitions themselves. Test-named helpers
//   are NOT exempt from fixture patterns: a helper importing a shared
//   fixture is flagged, closing the transitive prod -> helper ->
//   fixture leak.
// - The test-support pattern (production importing a *.test-* helper)
//   applies only to files that are neither test files nor test-named
//   helpers, so helpers may freely import other helpers.

export const FIXTURE_PATTERNS = [
  // Package-specifier imports of the fixture tree.
  /['"`]@baci\/shared\/test-fixtures\//,
  // Any quoted module specifier pointing into a test-fixtures tree,
  // including nested (`test-fixtures/piggyvest/schedule`) and dotted
  // stems, whatever the callee (import, require, export-from,
  // createRequire results, dynamic import). Bare path-prefix
  // constants that do not end in a module name are not matched.
  /['"`][^'"`]*test-fixtures\/(?:[\w.-]+\/)*[\w.-]*\w(?:\.[\w]+)?['"`]/,
  // A quoted path-prefix constant ending at the fixture-tree root:
  // the shape used to assemble a specifier dynamically
  // ('.../test-fixtures/' + name). Flagged so assembled imports cannot
  // slip past the literal patterns; fully dynamic specifiers built
  // from variables remain a documented code-review catch.
  /['"`][^'"`]*test-fixtures\/['"`]/,
];

export const TEST_SUPPORT_PATTERN =
  /['\"`](?:\.{1,2}\/|@baci\/|@\/|packages\/)(?:(?:[^'\"`]*?[-_./]|)test-(?:support|fixtures?|render|utils|helpers?|subject)[\w-]*(?:\.|['\"`])|[^'\"`]*?\.(?:test|spec|tests)(?:\.(?:m|c)?[tj]sx?)?['\"`]|[^'\"`]*?__tests__\/)/;

export function normalizePath(path: string) {
  return path.split(sep).join('/');
}

export function isTestFile(path: string) {
  const normalized = normalizePath(path);
  return (
    // Test-runner configs (Vitest/Jest) only ever execute tests, so
    // their alias registrations for fixture subpaths are legitimate.
    /(?:^|\/)(?:vitest|jest)\.config\.(?:m|c)?[tj]sx?$/.test(normalized) ||
    // Fixture definitions themselves are exempt.
    normalized.includes('/packages/shared/src/test-fixtures/') ||
    /\.(test|spec)\.(?:m|c)?[tj]sx?$/.test(normalized) ||
    /\.test-fixtures?\.(?:m|c)?[tj]sx?$/.test(normalized) ||
    /\.tests\.(?:m|c)?[tj]sx?$/.test(normalized)
  );
}

export function isTestHelper(path: string) {
  const normalized = normalizePath(path);
  return (
    // Metro config is a production bundle entry point: it stays
    // exempt from the test-support pattern but NOT from the fixture
    // patterns, so a Metro config importing a shared fixture (as
    // opposed to a test-runner alias registration) is flagged.
    /(?:^|\/)metro\.config\.(?:m|c)?[tj]sx?$/.test(normalized) ||
    normalized.includes('/__tests__/') ||
    /\.test-support\.(?:m|c)?[tj]sx?$/.test(normalized) ||
    /(?:^|[-_./])test-(?:support|fixtures?|render|utils|helpers?|subject)[\w-]*\.(?:m|c)?[tj]sx?$/.test(
      normalized
    )
  );
}

// Generated-output directories are skipped at any depth (for example
// ios/Pods or android/app/build inside a mobile app root).
const ALWAYS_SKIPPED = new Set([
  'node_modules',
  '.git',
  '.next',
  '.expo',
  '.turbo',
  '.gradle',
  'DerivedData',
  'web-build',
  'Pods',
]);
// Generic output names are skipped at a scan root, or under native
// ios/android trees (android/app/build, ios build output), where they
// are generated. A nested source directory with one of these names
// elsewhere in a source tree is still scanned.
const GENERATED_AT_ROOT_OR_NATIVE = new Set(['build', 'coverage', 'dist']);
// Skipped only as direct children of a scan root: developer CLI
// tooling (apps/*/tools) is executed in Node and never bundled, while
// a nested production directory named tools deeper in a source tree
// is still scanned.
const ROOT_LEVEL_SKIPPED = new Set(['tools', 'build', 'coverage', 'dist']);

export function collectSourceFiles(roots: string[]): string[] {
  const out: string[] = [];
  const visitedDirs = new Set<string>();
  const walk = (dir: string, isRoot: boolean, rel: string) => {
    for (const entry of readdirSync(dir)) {
      if (ALWAYS_SKIPPED.has(entry)) continue;
      if (isRoot && ROOT_LEVEL_SKIPPED.has(entry)) continue;
      const entryRel = rel ? `${rel}/${entry}` : entry;
      if (
        GENERATED_AT_ROOT_OR_NATIVE.has(entry) &&
        /(?:^|\/)(?:ios|android)(?:\/|$)/.test(entryRel)
      ) {
        continue;
      }
      const full = join(dir, entry);
      const stat = lstatSync(full);
      if (stat.isSymbolicLink()) {
        // Symlink policy: follow links that resolve inside a scan root
        // (with cycle protection via visitedDirs); skip links that
        // resolve outside every scan root or are broken. Content
        // reachable inside a root is scanned, never silently hidden.
        let target: string;
        try {
          target = realpathSync(full);
        } catch {
          continue;
        }
        const normalizedTarget = normalizePath(target);
        const inside = rootRealPaths.some((root) => {
          const normalizedRoot = normalizePath(root);
          return (
            normalizedTarget === normalizedRoot ||
            normalizedTarget.startsWith(`${normalizedRoot}/`)
          );
        });
        if (!inside) continue;
        const targetStat = lstatSync(target);
        if (targetStat.isDirectory()) {
          if (visitedDirs.has(target)) continue;
          visitedDirs.add(target);
          walk(full, false, entryRel);
        } else if (/\.(?:m|c)?[tj]sx?$/.test(target)) {
          // Classify by the resolved target's extension: a link with
          // an extensionless or non-source name still surfaces its
          // in-root source target for scanning.
          out.push(full);
        }
        continue;
      }
      if (stat.isDirectory()) {
        let real: string;
        try {
          real = realpathSync(full);
        } catch {
          real = full;
        }
        if (visitedDirs.has(real)) continue;
        visitedDirs.add(real);
        walk(full, false, entryRel);
      } else if (/\.(?:m|c)?[tj]sx?$/.test(entry)) {
        out.push(full);
      }
    }
  };
  const rootRealPaths = roots.map((root) => {
    try {
      return realpathSync(root);
    } catch {
      return root;
    }
  });
  for (const root of roots) {
    try {
      visitedDirs.add(realpathSync(root));
    } catch {
      // walk will surface the error
    }
    walk(root, true, '');
  }
  return out;
}

// Matching is intentionally raw-text and conservative: a fixture
// specifier appearing in a comment, a plain string, or a type-only
// import is flagged too. That is a deliberate hard failure — the
// specifier has no legitimate reason to appear in non-test code at
// all — rather than an attempt at import-aware parsing.
// Fixture-pattern-only scan, used for developer tooling trees
// (apps/*/tools): tooling may freely use test-named helpers, but a
// direct shared-fixture import there still executes test-double code
// outside the apps, so it is flagged.
const RUNNER_CONFIG_BASENAME =
  /^(?:vitest|jest|metro)\.config\.(?:m|c)?[tj]sx?$/;

// A runner-config basename only earns the test-file exemption when the
// file is a direct child of a scan root (where real runner configs
// live). A nested file that merely reuses the config basename is
// ordinary source and is scanned.
function isExemptFile(file: string, roots: string[]): boolean {
  if (!isTestFile(file)) return false;
  const normalized = normalizePath(file);
  const base = normalized.split('/').pop() ?? '';
  if (!RUNNER_CONFIG_BASENAME.test(base)) return true;
  const parent = normalized.slice(0, normalized.length - base.length - 1);
  return roots.some(
    (root) => normalizePath(resolve(root)) === parent
  );
}

function fixtureImportLines(content: string): string {
  return content
    .split('\n')
    .filter((line) => /^\s*(?:import|export)\b/.test(line) || /\b(?:require|import)\s*\(/.test(line))
    .join('\n');
}

export function findFixturePatternOffenders(roots: string[]): string[] {
  const offenders: string[] = [];
  for (const file of collectSourceFiles(roots)) {
    if (isExemptFile(file, roots)) continue;
    const content = readFileSync(file, 'utf8');
    if (FIXTURE_PATTERNS.some((pattern) => pattern.test(content))) {
      offenders.push(file);
    }
  }
  return offenders;
}

export function findFixtureImportOffenders(roots: string[]): string[] {
  const offenders: string[] = [];
  for (const file of collectSourceFiles(roots)) {
    const content = readFileSync(file, 'utf8');
    if (isExemptFile(file, roots)) {
      // Root runner configs are exempt for their alias/path-string
      // registrations, but an actual fixture import statement in a
      // config still executes fixture code, so import-like lines are
      // scanned with the fixture patterns.
      const base = normalizePath(file).split('/').pop() ?? '';
      if (
        RUNNER_CONFIG_BASENAME.test(base) &&
        FIXTURE_PATTERNS.some((pattern) =>
          pattern.test(fixtureImportLines(content))
        )
      ) {
        offenders.push(file);
      }
      continue;
    }
    if (FIXTURE_PATTERNS.some((pattern) => pattern.test(content))) {
      offenders.push(file);
      continue;
    }
    if (!isTestHelper(file) && TEST_SUPPORT_PATTERN.test(content)) {
      offenders.push(file);
    }
  }
  return offenders;
}
