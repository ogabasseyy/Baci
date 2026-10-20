import { lstatSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';

// Single source of truth for the shared test-fixtures import
// boundary (web Vitest guard + both mobile guards). Production code
// must never import @baci/shared/test-fixtures/*, directly or through
// a test-named helper. Fixture patterns apply to every scanned file
// except true test files and the fixture definitions; test-named
// helpers are NOT exempt from them (closing the transitive leak).
// The test-support pattern applies only to files that are neither
// test files nor test-named helpers. Full semantics: shared README.

export const FIXTURE_PATTERNS = [
  // Package-specifier imports of the fixture tree.
  /['"`]@baci\/shared\/test-fixtures\//,
  // Any quoted specifier into a test-fixtures tree, any callee.
  /['"`][^'"`]*test-fixtures\/(?:[\w.-]+\/)*[\w.-]*\w(?:\.[\w]+)?['"`]/,
  // Quoted path-prefix constants (assembled-specifier shapes).
  /['"`][^'"`]*test-fixtures\/['"`]/,
  // Template-literal prefix: `.../test-fixtures/${name}`.
  /['"`][^'"`]*test-fixtures\/\${/,
  // Nested path-prefix constant ending at a directory boundary.
  /['"`][^'"`]*test-fixtures\/(?:[\w.-]+\/)+['"`]/,
  // Split-literal assembly fragments (statically knowable).
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
    // Test-runner configs only execute tests; alias strings are fine.
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
    // Metro config is a production entry point: exempt from the
    // test-support pattern only, not from the fixture patterns.
    /(?:^|\/)(?:metro\.config\.|vitest\.(?:workspace|projects)\.)(?:m|c)?[tj]sx?$/.test(normalized) ||
    normalized.includes('/__tests__/') ||
    /\.test-support\.(?:m|c)?[tj]sx?$/.test(normalized) ||
    /(?:^|[-_./])test-(?:support|fixtures?|render|utils|helpers?|subject)[\w-]*\.(?:m|c)?[tj]sx?$/.test(
      normalized
    )
  );
}

// Generated-output directories skipped at any depth.
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
// Generic output names skipped at scan roots or under native
// ios/android trees; nested source dirs with these names are scanned.
const GENERATED_AT_ROOT_OR_NATIVE = new Set(['build', 'coverage', 'dist']);
// Skipped only as direct children of a scan root (apps/*/tools).
const ROOT_LEVEL_SKIPPED = new Set(['tools', 'build', 'coverage', 'dist']);

export function collectSourceFiles(roots: string[]): string[] {
  const out: string[] = [];
  // Ancestry-based cycle protection: the same real directory reached
  // through a second logical path is emitted under that path too.
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
          // Emit under the resolved target path for classification.
          walk(target, false, entryRel, chain);
        } else if (/\.(?:m|c)?[tj]sx?$/.test(target)) {
          out.push(target);
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

// Matching is intentionally raw-text and conservative (comments,
// plain strings, and type-only imports are flagged too).
// Fixture-pattern-only scan for developer tooling trees.
const RUNNER_CONFIG_BASENAME =
  /^(?:(?:vitest|jest|metro)\.config\.|vitest\.(?:workspace|projects)\.)(?:m|c)?[tj]sx?$/;

// A runner-config basename earns its exemption only as a direct
// child of a scan root; nested lookalikes are ordinary source.
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
// scanned (import/export-from, dynamic imports, first-string-arg
// resolver calls); alias registrations stay exempt.
const CONFIG_SPECIFIER_EXTRACTORS = [
  /(?:import|export)\b[^;]*?from\s*['"`][^'"`]*['"`]/g,
  /(?:import|export)\s*['"`][^'"`]*['"`]/g,
  /\bimport\s*\([^)]*\)/g,
  /\w+\s*\(\s*['"`][^'"`]*['"`](?:\s*,[^)]*)?\s*\)/g,
  /(?:const|let|var)\s+(\w+)(?:\s*:\s*[^=;]+)?\s*=\s*(['"`][^'"`]*['"`])/g,
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
  let out = content
    .replace(/\\\r?\n/g, '')
    .replace(
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
  const gap = String.raw`(?:\s|\/\*[\s\S]*?\*\/|\/\/[^\n]*(?:\n|$))*`;
  const fold = new RegExp(
    '([\'"`])([^\'"`]*)\\1' + gap + '\\+' + gap + '([\'"`])([^\'"`]*)\\3',
    'g'
  );
  let previous: string;
  do {
    previous = out;
    out = out.replace(fold, (m, q1: string, c1: string, _a: string, _b: string, _q: string, c2: string) =>
      c1.includes('${') || c2.includes('${') ? m : q1 + c1 + c2 + q1);
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
          String.raw`\b(?:import|\w+)\s*\(\s*(?:\/\*[\s\S]*?\*\/\s*)?` + name + String.raw`\b`
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
