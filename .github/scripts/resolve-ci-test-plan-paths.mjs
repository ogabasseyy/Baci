// Path classes for the CI test planner (`resolve-ci-test-plan.mjs`) and for the
// Vitest changed-files provider (`vitest-changed-files-provider.mjs`).
//
// Both import this file so they always agree on which paths are which. It only
// uses Node built-ins: the planner runs in the `changes` job before any
// dependency install.
//
// A changed path is checked against these classes:
//   1. full trigger      - shared code, CI wiring or test setup: run everything.
//                          (Listed in resolve-ci-test-plan.mjs, not here: the
//                          storefront release gate follows file names out of
//                          ci.yml at most 6 hops, and these names lead into
//                          apps/web, so they must stay one hop from the planner.)
//   2. web targeted      - apps/web code and tests: `vitest --changed` follows imports.
//   3. storefront        - mobile storefront code and tests: `jest --changedSince`.
//   4. fs-reader family  - data files that tests READ through fs (SQL, docs,
//                          workflows, ...). `vitest --changed` cannot follow
//                          those, so the changed-files provider adds the tests
//                          that mention the changed path.
//   5. in none of them   - unknown, so the planner keeps the full suite.
// One full trigger, or one unknown path, is enough to keep the full suite.

export const WEB_TARGETED_PREFIXES = [
  'apps/web/mcp-server/',
  'apps/web/src/',
  'apps/web/tools/',
  'apps/web/experience-runtime/',
  'apps/web/tests/experience-browser/',
];

// `vitest --changed` and `jest --changedSince` follow imports, so they can only
// select tests for code files. A fixture that a test reads through fs (a .txt,
// .json, .html or snapshot) is invisible to them, so in the folders added to
// the targeted classes by this planner only code files count; any other file
// there keeps the full suite.
const MODULE_FILE = /\.(?:[cm]?[jt]s|[jt]sx)$/;
// Folders under apps/web/tests whose code `vitest --changed` follows normally
// (route tests of the checkout harness, support code) and whose Playwright specs
// (`*.pw.ts`, never run by Vitest) run in checkout-browser.yml on every pull
// request. A Playwright spec anywhere else is unknown and keeps the full suite. The other test folders are not listed on purpose:
// several are excluded from the default Vitest run (see `exclude` in
// vitest.config.ts) and run through their own scripts, so they keep the full
// suite as before.
const WEB_BROWSER_TEST_FOLDERS = [
  'apps/web/tests/checkout-browser/',
  'apps/web/tests/oxygen-cookie-harness/',
  'apps/web/tests/oxygen-policy-browser/',
];

// Test files that sit directly in apps/web (for example
// `next.config.routing.test.ts`). Vitest runs them when they change.
const WEB_ROOT_TEST_FILE =
  /^apps\/web\/[^/]+\.(?:test|spec)\.(?:[cm]?[jt]s|[jt]sx)$/;

// Markdown in a workspace package marks that package as changed for Turbo, whose
// non-web test run would then include it; those paths stay unknown (full suite).
const MARKDOWN_FILE = /\.mdx?$/;
const WORKSPACE_PACKAGE_PATH =
  /^(?:apps\/mobile-admin|apps\/mobile-storefront|packages)\//;

export const MOBILE_STOREFRONT_TARGETED_PREFIXES = [
  'apps/mobile-storefront/app/',
  'apps/mobile-storefront/components/',
  'apps/mobile-storefront/constants/',
  'apps/mobile-storefront/hooks/',
  'apps/mobile-storefront/lib/',
  'apps/mobile-storefront/schemas/',
  'apps/mobile-storefront/services/',
  'apps/mobile-storefront/stores/',
];

// Jest test folder. Only code files: snapshots and fixtures keep the full suite.
// `config/` is deliberately NOT here: its `*.test.mjs` suites run through the
// storefront package's `test` script (node --test), which Jest's default
// patterns skip, so only the full path runs them. `__mocks__/` is not here
// either: Jest wires those files through `setupFiles` and `moduleNameMapper`,
// which `--changedSince` cannot map back to the tests that use them.
const MOBILE_STOREFRONT_MODULE_PREFIXES = ['apps/mobile-storefront/__tests__/'];

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
//                      piggyvest runbooks, ad-tracking guide); the provider
//                      finds the readers of whichever file changed, and most
//                      docs files have none. Unlike supabase/ (DB replay jobs)
//                      and vps-workers/ (own test job), nothing backs it up:
//                      the name match is its only safety net.
//   - .github metadata workflows other than ci.yml, filters, templates: read by
//                      a few contract tests; CI wiring itself stays a trigger.
//   - vps-workers/     has its own test job (`deploy_scripts` filter).
//   - markdown, .jules/, .ruler/, root notes, vercel.json.
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
];

export function isTargetableWebFile(file) {
  return (
    WEB_TARGETED_PREFIXES.some((prefix) => file.startsWith(prefix)) ||
    WEB_ROOT_TEST_FILE.test(file) ||
    (WEB_BROWSER_TEST_FOLDERS.some((folder) => file.startsWith(folder)) &&
      MODULE_FILE.test(file))
  );
}

export function isTargetableMobileStorefrontFile(file) {
  return (
    MOBILE_STOREFRONT_TARGETED_PREFIXES.some((prefix) =>
      file.startsWith(prefix)
    ) ||
    (MOBILE_STOREFRONT_MODULE_PREFIXES.some((prefix) =>
      file.startsWith(prefix)
    ) &&
      MODULE_FILE.test(file))
  );
}

// Vitest reruns its whole suite when any package.json or Vite/Vitest config is in
// the changed list (its default `forceRerunTriggers`). Routed to a targeted plan
// that would put every test in the single unsharded job, so these files go to
// the sharded full path instead, wherever they sit.
const PACKAGE_JSON = /(?:^|\/)package\.json$/;
const VITE_CONFIG = /(?:^|\/)(?:vitest|vite)\.config\.[^/]+$/;

export function isSharedConfigFile(file) {
  return PACKAGE_JSON.test(file) || VITE_CONFIG.test(file);
}

const TEST_FILE_NAME = /\.(?:test|spec)\.[^/]+$/;

// A deleted (or renamed-away) source file can leave unchanged tests that still
// import it. Neither `vitest --changed` nor Jest can select those tests, because
// the import no longer resolves, so such a deletion keeps the full suite, and so
// does a deleted fixture next to the code in a targeted folder. Deleted tests and
// deleted files of the reader families (docs, migrations, workflows, the replay
// registry, ...) do not: nothing imports a test, and the provider finds the
// readers of a family file by name.
export function isDeletedSourceFile(file) {
  return (
    (isTargetableWebFile(file) || isTargetableMobileStorefrontFile(file)) &&
    !isFsReaderFile(file) &&
    !TEST_FILE_NAME.test(file)
  );
}

export function fsReaderFamilyOf(file) {
  return FS_READER_FAMILIES.find((family) => family.matches(file));
}

export function isFsReaderFile(file) {
  return fsReaderFamilyOf(file) !== undefined;
}

// A bare file name only counts when a path separator or a quote sits right before
// it (`join(dir, 'config.toml')`, `../vercel.json`), so `wrangler.config.toml` or a
// word in prose does not select tests.
function bareNameNeedles(name) {
  return [`/${name}`, `'${name}`, `"${name}`, `\`${name}`];
}

// Strings to look for in test sources to find the readers of `file`: the file
// itself, its ancestor directories down to the family floor, and (for files at
// the repo or app root, or one folder deep) its bare name. Anything inside
// apps/web is also offered relative to the app root, because tests resolve
// paths from `process.cwd()`.
export function readerNeedlesFor(file) {
  const family = fsReaderFamilyOf(file);
  if (!family) {
    return [];
  }

  const needles = new Set();
  const segments = file.split('/');
  if (segments.length === 1) {
    for (const needle of bareNameNeedles(file)) needles.add(needle);
  } else {
    needles.add(file);
  }
  for (let depth = segments.length - 1; depth >= family.floor; depth -= 1) {
    needles.add(segments.slice(0, depth).join('/'));
  }
  if (segments.length === 2) {
    for (const needle of bareNameNeedles(segments[1])) needles.add(needle);
  }
  for (const needle of [...needles]) {
    if (needle.startsWith('apps/web/')) {
      const relative = needle.slice('apps/web/'.length);
      if (relative.includes('/')) {
        needles.add(relative);
      } else {
        for (const bare of bareNameNeedles(relative)) needles.add(bare);
      }
    }
  }
  for (const name of family.names ?? []) {
    needles.add(name);
  }

  return [...needles];
}
