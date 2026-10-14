// Transitive shared-module closure of the lab render graph.
//
// The pilot-codec suites must run when lab rendering/hydration can
// change, but hand-maintained path lists rot (review rounds kept
// finding depth-2 shared imports the pattern missed). This walker
// computes the closure from source so the contract test fails
// closed: any newly reachable shared module must be added to the
// workflow pattern before the test passes again.
//
// Bounds (documented, deliberate):
// - Depth <= 2 from the lab-owned roots plus the two established
//   shared render seeds (product-card, storefront-product-href).
//   Depth 1 is direct render/helpers; depth 2 is their render
//   helpers (geometry, skeletons, serialization). Deeper state/
//   persistence/checkout modules are covered by their owners' unit
//   tests plus the root turbo gates; only the WebKit codec smoke
//   and transformer suites are path-gated.
// - Whole-line `import type` / `export type` edges are skipped
//   (erased at runtime; typecheck covers them). Mixed imports stay.
// - Test/spec files are never seeds and never traversed into: test
//   changes must not force the smoke suites.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(here, '..', '..');

const SRC_PREFIX = 'apps/web/src';

// Pilot-owned: covered by the pattern's pilot-tree branches, so they
// seed and traverse but never land in the shared set.
const PILOT_OWNED_PREFIXES = [
  `${SRC_PREFIX}/app/pilot-lab/`,
  `${SRC_PREFIX}/lib/merchant-image-variant-pilot/`,
  `${SRC_PREFIX}/config/pilot-`,
  `${SRC_PREFIX}/schemas/merchant-image-variant-pilot`,
  `${SRC_PREFIX}/instrumentation`,
  'apps/web/next.config',
];

const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];
const PROBE_EXTENSIONS = [...SOURCE_EXTENSIONS, '.css', '.json'];
const TYPE_ONLY_LINE = /^\s*(import|export)\s+type[\s{]/;
const SPECIFIER =
  /(?:from\s+|import\s*\(|require\s*\()\s*['"]([^'"]+)['"]/g;

function listSourceFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listSourceFiles(path));
    } else if (
      PROBE_EXTENSIONS.some((ext) => entry.name.endsWith(ext)) &&
      !/\.(test|spec)\./.test(entry.name)
    ) {
      out.push(path);
    }
  }
  return out;
}

function isFile(path) {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

// Resolves @/ and relative specifiers to absolute source paths.
// Bare packages (node_modules; covered by the package.json branch)
// and paths outside apps/web/src never resolve.
function resolveSpecifier(fromFile, specifier) {
  const srcDir = join(REPO_ROOT, SRC_PREFIX);
  let base;
  if (specifier.startsWith('@/')) {
    base = join(srcDir, specifier.slice(2));
  } else if (
    specifier.startsWith('./') ||
    specifier.startsWith('../')
  ) {
    base = resolve(dirname(fromFile), specifier);
  } else {
    return null;
  }
  if (!base.startsWith(srcDir)) {
    return null;
  }
  const candidates = [
    base,
    ...PROBE_EXTENSIONS.map((ext) => `${base}${ext}`),
    join(base, 'index.ts'),
    join(base, 'index.tsx'),
  ];
  return (
    candidates.find(
      (candidate) =>
        isFile(candidate) && !/\.(test|spec)\./.test(candidate)
    ) || null
  );
}

function runtimeSpecifiers(source) {
  const specifiers = [];
  for (const line of source.split('\n')) {
    if (TYPE_ONLY_LINE.test(line)) {
      continue;
    }
    for (const match of line.matchAll(SPECIFIER)) {
      specifiers.push(match[1]);
    }
  }
  return specifiers;
}

export function labSharedClosure({ maxDepth = 2 } = {}) {
  const srcDir = join(REPO_ROOT, SRC_PREFIX);
  const seeds = [
    ...listSourceFiles(join(srcDir, 'app/pilot-lab')),
    ...listSourceFiles(join(srcDir, 'lib/merchant-image-variant-pilot')),
    join(srcDir, 'components/storefront/product-card.tsx'),
    join(srcDir, 'lib/storefront-product-href.ts'),
  ];
  // BFS: exact shortest depths, so the bound is a real bound.
  const depth = new Map(seeds.map((seed) => [seed, 0]));
  const queue = [...seeds];
  while (queue.length > 0) {
    const file = queue.shift();
    const fileDepth = depth.get(file);
    if (
      !isFile(file) ||
      !SOURCE_EXTENSIONS.some((ext) => file.endsWith(ext))
    ) {
      continue;
    }
    for (const specifier of runtimeSpecifiers(
      readFileSync(file, 'utf8')
    )) {
      const resolved = resolveSpecifier(file, specifier);
      if (resolved && !depth.has(resolved)) {
        depth.set(resolved, fileDepth + 1);
        queue.push(resolved);
      }
    }
  }
  const shared = [];
  for (const [file, fileDepth] of depth) {
    if (fileDepth === 0 || fileDepth > maxDepth) {
      continue;
    }
    const relative = file.slice(REPO_ROOT.length + 1);
    if (
      PILOT_OWNED_PREFIXES.some((prefix) =>
        relative.startsWith(prefix)
      )
    ) {
      continue;
    }
    shared.push(relative);
  }
  return shared.sort();
}
