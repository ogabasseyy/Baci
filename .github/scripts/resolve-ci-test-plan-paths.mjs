// Path classes for the CI test planner (`resolve-ci-test-plan.mjs`) and for the
// Vitest changed-files provider (`vitest-changed-files-provider.mjs`).
//
// Both import this file so they always agree on which paths are which. It only
// uses Node built-ins: the planner runs in the `changes` job before any
// dependency install.
//
// A changed path falls into exactly one class, checked in this order:
//   1. full trigger      - shared code, CI wiring or test setup: run everything.
//   2. web targeted      - apps/web code and tests: `vitest --changed` follows imports.
//   3. storefront        - mobile storefront code and tests: `jest --changedSince`.
//   4. fs-reader family  - data files that tests READ through fs (SQL, docs,
//                          workflows, ...). `vitest --changed` cannot follow
//                          those, so the changed-files provider adds the tests
//                          that mention the changed path.
//   5. anything else     - unknown, so the planner keeps the full suite.

export const ROOT_FULL_TEST_FILES = new Set([
  '.github/scripts/experience-runner-ci.test.mjs',
  '.npmrc',
  '.github/scripts/resolve-ci-test-plan.mjs',
  '.github/scripts/resolve-ci-test-plan-config.mjs',
  '.github/scripts/resolve-ci-test-plan-config.test.mjs',
  '.github/scripts/resolve-ci-test-plan.test.mjs',
  '.github/workflows/ci.yml',
  'biome.json',
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'turbo.json',
]);

export const ROOT_FULL_TEST_PREFIXES = [
  '.github/actions/',
  // The planner, its path classes and the Vitest provider decide what CI runs.
  '.github/scripts/resolve-ci-test-plan',
  '.github/scripts/vitest-changed-files-provider',
  'packages/shared/',
  'packages/experience-sdk/',
  'tsconfig',
];

export const WEB_FULL_TEST_FILES = new Set([
  'apps/web/jest.config.mjs',
  'apps/web/jest.setup.js',
  'apps/web/next.config.test.ts',
  'apps/web/next.config.ts',
  'apps/web/package.json',
  'apps/web/tsconfig.json',
  'apps/web/vitest.config.ts',
  'apps/web/vitest.experience-runner.config.ts',
  'apps/web/vitest.setup.ts',
]);

export const MOBILE_STOREFRONT_FULL_TEST_FILES = new Set([
  'apps/mobile-storefront/app.config.ts',
  'apps/mobile-storefront/babel.config.js',
  'apps/mobile-storefront/jest.config.js',
  'apps/mobile-storefront/jest.setup.ts',
  'apps/mobile-storefront/metro.config.js',
  'apps/mobile-storefront/package.json',
  'apps/mobile-storefront/tsconfig.json',
]);

export const WEB_TARGETED_PREFIXES = [
  'apps/web/mcp-server/',
  'apps/web/src/',
  'apps/web/tools/',
  'apps/web/experience-runtime/',
  'apps/web/tests/',
];

// Test files that sit directly in apps/web (for example
// `next.config.routing.test.ts`). Vitest runs them when they change.
const WEB_ROOT_TEST_FILE = /^apps\/web\/[^/]+\.test\.(?:[cm]?[jt]s|[jt]sx)$/;

// Playwright specs are executed by their own browser workflows, never by Vitest.
const PLAYWRIGHT_SPEC = /^apps\/web\/.*\.pw\.[jt]sx?$/;

// Markdown in a workspace package marks that package as changed for Turbo, whose
// non-web test run would then include it; those paths stay unknown (full suite).
const MARKDOWN_FILE = /\.mdx?$/;
const WORKSPACE_PACKAGE_PATH =
  /^(?:apps\/mobile-admin|apps\/mobile-storefront|packages)\//;

export const MOBILE_STOREFRONT_TARGETED_PREFIXES = [
  'apps/mobile-storefront/__mocks__/',
  'apps/mobile-storefront/__tests__/',
  'apps/mobile-storefront/app/',
  'apps/mobile-storefront/components/',
  'apps/mobile-storefront/config/',
  'apps/mobile-storefront/constants/',
  'apps/mobile-storefront/hooks/',
  'apps/mobile-storefront/lib/',
  'apps/mobile-storefront/schemas/',
  'apps/mobile-storefront/services/',
  'apps/mobile-storefront/stores/',
];

// Data files that tests read through fs. `floor` is the shallowest ancestor
// directory (counted in path segments) the provider searches for in test
// sources; `names` are extra needles for distinctive bare names that tests
// build with a join (for example `replay-registry`).
//
// Why each family is safe to hand to the provider instead of forcing the full
// suite:
//   - supabase/        migrations and SQL fixtures; the DB replay jobs still run
//                      in full whenever these paths change (`quiz_db` filter).
//   - replay registry  validated by the DB replay job as well; its readers are
//                      the tools/db tests that mention the registry folder.
//   - docs/            read by a handful of tests (storefront-edge inventory,
//                      piggyvest runbooks, ad-tracking guide); everything else
//                      has no reader at all.
//   - .github metadata workflows other than ci.yml, filters, templates: read by
//                      a few contract tests; CI wiring itself stays a trigger.
//   - vps-workers/     has its own test job (`deploy_scripts` filter).
//   - markdown, .jules/, .ruler/, root notes, vercel.json, Playwright specs.
export const FS_READER_FAMILIES = [
  { id: 'supabase', matches: (file) => file.startsWith('supabase/'), floor: 2 },
  {
    id: 'replay-registry',
    matches: (file) => file.startsWith('apps/web/tools/db/replay-registry/'),
    floor: 5,
    names: ['replay-registry'],
  },
  {
    id: 'docs',
    matches: (file) => file.startsWith('docs/'),
    floor: 2,
    names: ["'docs'", '"docs"', '`docs`'],
  },
  {
    id: 'github-metadata',
    matches: (file) =>
      /^\.github\/(?:workflows|filters|cloudflare|ISSUE_TEMPLATE)\//.test(
        file
      ) ||
      /^\.github\/[^/]+\.(?:md|ya?ml|json|txt)$/.test(file) ||
      file === '.github/CODEOWNERS',
    floor: 2,
  },
  {
    id: 'vps-workers',
    matches: (file) => file.startsWith('vps-workers/'),
    floor: 2,
  },
  {
    id: 'agent-notes',
    matches: (file) =>
      file.startsWith('.jules/') ||
      file.startsWith('.ruler/') ||
      file === '.coderabbit.yaml',
    floor: 1,
  },
  // Files that no directory search can describe: only the file itself counts.
  {
    id: 'markdown',
    matches: (file) =>
      MARKDOWN_FILE.test(file) && !WORKSPACE_PACKAGE_PATH.test(file),
    floor: Number.POSITIVE_INFINITY,
  },
  { id: 'vercel', matches: (file) => file === 'vercel.json', floor: 1 },
  {
    id: 'playwright',
    matches: (file) => PLAYWRIGHT_SPEC.test(file),
    floor: Number.POSITIVE_INFINITY,
  },
];

export function isFullAffectedTrigger(file) {
  return (
    ROOT_FULL_TEST_FILES.has(file) ||
    WEB_FULL_TEST_FILES.has(file) ||
    MOBILE_STOREFRONT_FULL_TEST_FILES.has(file) ||
    ROOT_FULL_TEST_PREFIXES.some((prefix) => file.startsWith(prefix))
  );
}

export function isTargetableWebFile(file) {
  return (
    WEB_TARGETED_PREFIXES.some((prefix) => file.startsWith(prefix)) ||
    WEB_ROOT_TEST_FILE.test(file)
  );
}

export function isTargetableMobileStorefrontFile(file) {
  return MOBILE_STOREFRONT_TARGETED_PREFIXES.some((prefix) =>
    file.startsWith(prefix)
  );
}

export function fsReaderFamilyOf(file) {
  return FS_READER_FAMILIES.find((family) => family.matches(file));
}

export function isFsReaderFile(file) {
  return fsReaderFamilyOf(file) !== undefined;
}

// Strings to look for in test sources to find the readers of `file`: the file
// itself, its ancestor directories down to the family floor, and (for files at
// the repo or app root) its bare name. Anything inside apps/web is also offered
// relative to the app root, because tests resolve paths from `process.cwd()`.
export function readerNeedlesFor(file) {
  const family = fsReaderFamilyOf(file);
  if (!family) {
    return [];
  }

  const needles = new Set([file]);
  const segments = file.split('/');
  for (let depth = segments.length - 1; depth >= family.floor; depth -= 1) {
    needles.add(segments.slice(0, depth).join('/'));
  }
  if (segments.length <= 2) {
    needles.add(segments.at(-1));
  }
  for (const needle of [...needles]) {
    if (needle.startsWith('apps/web/')) {
      needles.add(needle.slice('apps/web/'.length));
    }
  }
  for (const name of family.names ?? []) {
    needles.add(name);
  }

  return [...needles];
}
