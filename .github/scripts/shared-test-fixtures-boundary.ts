import { lstatSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';

// Single source of truth for the shared test-fixtures import
// boundary (web + both mobile guards). Production code must never
// import @baci/shared/test-fixtures/*, directly or through a
// test-named helper. Full semantics: packages/shared/README.md.

const SOURCE_EXT = /\.(?:m|c)?[tj]sx?$/;

export const FIXTURE_PATTERNS = [
  /['"`]@baci\/shared\/test-fixtures\//,
  /['"`][^'"`]*test-fixtures\/(?:[\w.-]+\/)*[\w.-]*\w(?:\.[\w]+)?['"`]/,
  /['"`][^'"`]*test-fixtures\/['"`]/,
  /['"`][^'"`]*test-fixtures\/\${/,
  /['"`][^'"`]*test-fixtures\/(?:[\w.-]+\/)+['"`]/,
  /['"`](?:[^'"`]*?[-_./]|)test-['"`]\s*\+/,
  /\+\s*['"`][^'"`]*fixtures\/[^'"`]*['"`]/,
];

export const TEST_SUPPORT_PATTERN =
  /['\"`](?:\.{1,2}\/|@baci\/|@\/|packages\/)(?:(?:[^'\"`]*?[-_./]|)test-(?:support|fixtures?|render|utils|helpers?|subject)[\w-]*(?:[./]|['\"`])|[^'\"`]*?\.(?:test|spec|tests)(?:\.(?:m|c)?[tj]sx?)?['\"`]|[^'\"`]*?__tests__(?:\/|['\"`]))/;

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
    /\.tests\.(?:m|c)?[tj]sx?$/.test(normalized)
  );
}

export function isTestHelper(path: string) {
  const normalized = normalizePath(path);
  return (
    /(?:^|\/)test-(?:support|fixtures?|render|utils|helpers?|subject)\//.test(
      normalized
    ) ||
    // Metro config: exempt from test-support pattern only.
    /(?:^|\/)(?:metro\.config\.|vitest\.(?:workspace|projects)\.)(?:m|c)?[tj]sx?$/.test(normalized) ||
    normalized.includes('/__tests__/') ||
    /\.test-support\.(?:m|c)?[tj]sx?$/.test(normalized) ||
    /\.test-fixtures?\.(?:m|c)?[tj]sx?$/.test(normalized) ||
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
// Generic output names skipped at scan roots or under ios/android.
const GENERATED_AT_ROOT_OR_NATIVE = new Set(['build', 'coverage', 'dist']);
// Skipped only as direct children of a scan root (apps/*/tools).
const ROOT_LEVEL_SKIPPED = new Set(['tools', 'build', 'coverage', 'dist']);

export function collectSourceFiles(roots: string[]): string[] {
  const out: string[] = [];
  // Ancestry-based cycle protection (see README).
  const walk = (
    dir: string,
    isRoot: boolean,
    rel: string,
    ancestors: ReadonlySet<string>
  ) => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    let dirReal: string;
    try {
      dirReal = realpathSync(dir);
    } catch {
      dirReal = dir;
    }
    if (ancestors.has(dirReal)) return;
    const chain = new Set(ancestors);
    chain.add(dirReal);
    for (const entry of entries) {
      const full = join(dir, entry);
      let stat: ReturnType<typeof lstatSync>;
      try {
        stat = lstatSync(full);
      } catch {
        continue;
      }
      // Symlinks bypass name-based exclusions (containment below).
      const isLink = stat.isSymbolicLink();
      if (!isLink && ALWAYS_SKIPPED.has(entry)) continue;
      if (!isLink && isRoot && ROOT_LEVEL_SKIPPED.has(entry)) continue;
      const entryRel = rel ? `${rel}/${entry}` : entry;
      if (
        !isLink &&
        GENERATED_AT_ROOT_OR_NATIVE.has(entry) &&
        /(?:^|\/)(?:ios|android)(?:\/|$)/.test(entryRel)
      ) {
        continue;
      }
      if (stat.isSymbolicLink()) {
        // Symlink policy: follow in-root links; skip external/broken.
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
        let targetStat: ReturnType<typeof lstatSync>;
        try {
          targetStat = lstatSync(target);
        } catch {
          continue;
        }
        if (targetStat.isDirectory()) {
          // Emit under both link and target paths for classification.
          walk(full, false, entryRel, chain);
          walk(target, false, entryRel, chain);
        } else if (targetStat.isFile() && (SOURCE_EXT.test(entry) || SOURCE_EXT.test(target))) {
          out.push(full);
          if (target !== full) out.push(target);
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

// Matching is intentionally raw-text and conservative.

const RUNNER_CONFIG_BASENAME =
  /^(?:(?:vitest|jest|metro)\.config\.|vitest\.(?:workspace|projects)\.)(?:m|c)?[tj]sx?$/;

// Runner-config exemption applies only at a scan root.
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
// scanned; alias registrations stay exempt.
const CONFIG_SPECIFIER_EXTRACTORS = [
  /(?:import|export)\b[^;]*?from(?:\s|\/\*[\s\S]*?\*\/|\/\/[^\n]*(?:\n|$))*['"`][^'"`]*['"`]/g,
  /(?:import|export)(?:\s|\/\*[\s\S]*?\*\/|\/\/[^\n]*(?:\n|$))*['"`][^'"`]*['"`]/g,
  /\bimport(?:\s|\/\*[\s\S]*?\*\/|\/\/[^\n]*(?:\n|$))*\([^)]*\)/g,
  /\w+\s*\((?:\s|\/\*[\s\S]*?\*\/|\/\/[^\n]*(?:\n|$))*['"`][^'"`]*['"`](?:\s*,[^)]*)?\s*\)/g,
  /(?:const|let|var)\s+(\w+)(?:\s*:\s*[^=;]+)?\s*=\s*(['"`][^'"`]*['"`])/g,
];

const PATH_CONSTRUCTOR_CALL =
  /^(?:\w+\.)?(?:resolve|join|dirname|basename|extname|relative|normalize|parse|format|isAbsolute)\s*\(/;
// Module resolvers stay scanned (unlike path constructors).

// Scanning runs on a normalized view: escapes decoded inside string
// literals and adjacent literals constant-folded.
function normalizeContent(content: string): string {
  // Decode escapes only inside quoted string literals.
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
    out = out.replace(fold, (m, q1: string, c1: string, _q2: string, c2: string) =>
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
        // Constant assignments retained only when actually loaded.
        const used = new RegExp(
          String.raw`\b(?:import|\w+)\s*\(\s*(?:\/\*[\s\S]*?\*\/\s*)?` + name + String.raw`\b`
        );
        if (used.test(content)) parts.push(literal);
        continue;
      }
      const owner = /([\w$]+)\s*(?:\/\*[\s\S]*?\*\/\s*)*\.\s*(?:\/\*[\s\S]*?\*\/\s*)?$/.exec(content.slice(0, match.index))?.[1];
      const isPathCall =
        PATH_CONSTRUCTOR_CALL.test(text) &&
        owner !== 'require' &&
        owner !== 'meta';
      if (!isPathCall) parts.push(text);
    }
  }
  return parts.join('\n');
}

function isOffender(
  file: string,
  roots: string[],
  withSupport: boolean
): boolean {
  let raw: string;
  try {
    raw = readFileSync(file, 'utf8');
  } catch {
    return false;
  }
  const content = normalizeContent(raw);
  if (isExemptFile(file, roots)) {
    // Runner configs: alias registrations exempt, imports scanned.
    const base = normalizePath(file).split('/').pop() ?? '';
    return (
      RUNNER_CONFIG_BASENAME.test(base) &&
      FIXTURE_PATTERNS.some((pattern) =>
        pattern.test(configSpecifiers(content))
      )
    );
  }
  if (FIXTURE_PATTERNS.some((pattern) => pattern.test(content))) return true;
  return withSupport && !isTestHelper(file) && TEST_SUPPORT_PATTERN.test(content);
}

export function findFixturePatternOffenders(roots: string[]): string[] {
  return collectSourceFiles(roots).filter((file) =>
    isOffender(file, roots, false)
  );
}

export function findFixtureImportOffenders(roots: string[]): string[] {
  return collectSourceFiles(roots).filter((file) =>
    isOffender(file, roots, true)
  );
}
