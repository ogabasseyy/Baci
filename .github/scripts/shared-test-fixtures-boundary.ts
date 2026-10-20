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
  // Template-literal prefix: `.../test-fixtures/${name}`.
  /['"`][^'"`]*test-fixtures\/\${/,
  // Nested path-prefix constant: a quoted literal inside the fixture
  // tree ending at a directory boundary ('../test-fixtures/piggyvest/').
  /['"`][^'"`]*test-fixtures\/(?:[\w.-]+\/)+['"`]/,
  // Split-literal assembly: a quoted fragment ending in test-
  // concatenated with the rest of the specifier, or a fixtures/
  // fragment concatenated onto a prefix. Statically knowable, so
  // flagged; only fully variable-built specifiers remain a
  // code-review catch.
  /['"`](?:[^'"`]*?[-_./]|)test-['"`]\s*\+/,
  /\+\s*['"`][^'"`]*fixtures\/[^'"`]*['"`]/,
];

export const TEST_SUPPORT_PATTERN =
  /['\"`](?:\.{1,2}\/|@baci\/|@\/|packages\/)(?:(?:[^'\"`]*?[-_./]|)test-(?:support|fixtures?|render|utils|helpers?|subject)[\w-]*(?:[./]|['\"`])|[^'\"`]*?\.(?:test|spec|tests)(?:\.(?:m|c)?[tj]sx?)?['\"`]|[^'\"`]*?__tests__\/)/;

export function normalizePath(path: string) {
  return path.split(sep).join('/');
}

export function isTestFile(path: string) {
  const normalized = normalizePath(path);
  return (
    // Test-runner configs (Vitest/Jest) only ever execute tests, so
    // their alias registrations for fixture subpaths are legitimate.
    /(?:^|\/)(?:(?:vitest|jest)\.config\.|vitest\.(?:workspace|projects)\.)(?:m|c)?[tj]sx?$/.test(normalized) ||
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
    /(?:^|\/)test-(?:support|fixtures?|render|utils|helpers?|subject)\//.test(
      normalized
    ) ||
    // Metro config is a production bundle entry point: it stays
    // exempt from the test-support pattern but NOT from the fixture
    // patterns, so a Metro config importing a shared fixture (as
    // opposed to a test-runner alias registration) is flagged.
    /(?:^|\/)(?:metro\.config\.|vitest\.(?:workspace|projects)\.)(?:m|c)?[tj]sx?$/.test(normalized) ||
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
  // Cycle protection is ancestry-based (realpaths of the current
  // directory chain), not a global visited set: the same real
  // directory reached through a second logical path is emitted again
  // under that path, because file classification is path-based.
  const walk = (
    dir: string,
    isRoot: boolean,
    rel: string,
    ancestors: ReadonlySet<string>
  ) => {
    let dirReal: string;
    try {
      dirReal = realpathSync(dir);
    } catch {
      dirReal = dir;
    }
    if (ancestors.has(dirReal)) return;
    const chain = new Set(ancestors);
    chain.add(dirReal);
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
        // (with ancestry-based cycle protection); skip links that
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
          walk(full, false, entryRel, chain);
        } else if (/\.(?:m|c)?[tj]sx?$/.test(target)) {
          // Classify by the resolved target's extension: a link with
          // an extensionless or non-source name still surfaces its
          // in-root source target for scanning.
          out.push(full);
        }
        continue;
      }
      if (stat.isDirectory()) {
        walk(full, false, entryRel, chain);
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
    walk(root, true, '', new Set());
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
  /^(?:(?:vitest|jest|metro)\.config\.|vitest\.(?:workspace|projects)\.)(?:m|c)?[tj]sx?$/;

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

// For exempt runner configs, only specifier-bearing constructs are
// scanned: import/export-from statements (including multiline),
// side-effect imports, dynamic imports, and resolver calls whose
// first argument is a string literal (including multiline calls).
// Alias registrations (find/replacement values, path.resolve targets)
// are not specifier-bearing and stay exempt.
const CONFIG_SPECIFIER_EXTRACTORS = [
  /(?:import|export)\b[^;]*?from\s*['"`][^'"`]*['"`]/g,
  /(?:import|export)\s*['"`][^'"`]*['"`]/g,
  /\bimport\s*\([^)]*\)/g,
  /\w+\s*\(\s*['"`][^'"`]*['"`](?:\s*,[^)]*)?\s*\)/g,
  /(?:const|let|var)\s+(\w+)\s*=\s*(['"`][^'"`]*['"`])/g,
];

const PATH_CONSTRUCTOR_CALL =
  /^(?:\w+\.)?(?:resolve|join|dirname|basename|extname|relative|normalize|parse|format|isAbsolute)\s*\(/;

// Scanning runs on a normalized view of the source: literal escape
// sequences are decoded (so test\x2dfixtures is seen as test-fixtures)
// and adjacent string literals are constant-folded (so
// 'test-' + 'fixtures/x' is seen as one specifier). This closes
// statically knowable assembly forms; only specifiers built from
// runtime variables remain a documented code-review catch.
function normalizeContent(content: string): string {
  // Decode escapes only inside quoted string literals, so regex
  // literals and other escaped text keep their semantics.
  let out = content.replace(
    /'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|`(?:\\.|[^`\\])*`/g,
    (literal) =>
      literal
        .replace(/\\x([0-9a-fA-F]{2})/g, (_m, hex: string) =>
          String.fromCharCode(Number.parseInt(hex, 16))
        )
        .replace(/\\u\{([0-9a-fA-F]+)\}/g, (_m, hex: string) =>
          String.fromCodePoint(Number.parseInt(hex, 16))
        )
        .replace(/\\u([0-9a-fA-F]{4})/g, (_m, hex: string) =>
          String.fromCharCode(Number.parseInt(hex, 16))
        )
        .replace(/\\(.)/g, '$1')
  );
  const gap = String.raw`(?:\s|\/\*[\s\S]*?\*\/|\/\/[^\n]*(?:\n|$))+`;
  const fold = new RegExp(
    String.raw`(['"])([^'"]*)\1` + gap + String.raw`\+` + gap + String.raw`(['"])([^'"]*)\3`,
    'g'
  );
  let previous: string;
  do {
    previous = out;
    out = out.replace(fold, '$1$2$4$1');
  } while (out !== previous);
  return out;
}

function configSpecifiers(content: string): string {
  const parts: string[] = [];
  for (const pattern of CONFIG_SPECIFIER_EXTRACTORS) {
    for (const match of content.matchAll(pattern)) {
      const [text, name, literal] = match;
      if (name !== undefined && literal !== undefined) {
        // Constant assignments are retained only when the identifier
        // is actually loaded (dynamic import or resolver call) in the
        // same config; a bare alias registration stays exempt.
        const used = new RegExp(
          String.raw`\b(?:import|\w+)\s*\(\s*` + name + String.raw`\b`
        );
        if (used.test(content)) parts.push(literal);
        continue;
      }
      if (!PATH_CONSTRUCTOR_CALL.test(text)) parts.push(text);
    }
  }
  return parts.join('\n');
}

export function findFixturePatternOffenders(roots: string[]): string[] {
  const offenders: string[] = [];
  for (const file of collectSourceFiles(roots)) {
    if (isExemptFile(file, roots)) continue;
    const content = normalizeContent(readFileSync(file, 'utf8'));
    if (FIXTURE_PATTERNS.some((pattern) => pattern.test(content))) {
      offenders.push(file);
    }
  }
  return offenders;
}

export function findFixtureImportOffenders(roots: string[]): string[] {
  const offenders: string[] = [];
  for (const file of collectSourceFiles(roots)) {
    const content = normalizeContent(readFileSync(file, 'utf8'));
    if (isExemptFile(file, roots)) {
      // Root runner configs are exempt for their alias/path-string
      // registrations, but an actual fixture import statement in a
      // config still executes fixture code, so import-like lines are
      // scanned with the fixture patterns.
      const base = normalizePath(file).split('/').pop() ?? '';
      if (
        RUNNER_CONFIG_BASENAME.test(base) &&
        FIXTURE_PATTERNS.some((pattern) =>
          pattern.test(configSpecifiers(content))
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
