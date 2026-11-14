import { pathToFileURL } from 'node:url';
import {
  parseArgs,
  singleLine,
  writeGithubOutput,
} from './resolve-ci-test-plan-cli.mjs';
import { ciTestPlanConfig } from './resolve-ci-test-plan-config.mjs';
import {
  getChangedFiles,
  getDeletedFiles,
} from './resolve-ci-test-plan-git.mjs';
import {
  isDeletedSourceFile,
  isFsReaderFile,
  isSharedConfigFile,
  isTargetableMobileStorefrontFile,
  isTargetableWebFile,
  keepsFullForSourceData,
} from './resolve-ci-test-plan-paths.mjs';
import { findNonWebReaders } from './resolve-ci-test-plan-readers.mjs';
import {
  DELETED_SOURCE_REASON,
  DELETED_UNKNOWN_REASON,
  NON_WEB_READER_REASON,
  READER_SEARCH_FAILED_REASON,
  SOURCE_DATA_REASON,
  STOREFRONT_READER_REASON,
  STOREFRONT_REASON,
  WEB_AND_STOREFRONT_REASON,
  WEB_READER_REASON,
  WEB_SOURCE_REASON,
} from './resolve-ci-test-plan-reasons.mjs';

const FULL_AFFECTED_COMMAND =
  'pnpm turbo run test --concurrency=3 --log-order=stream';

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
  // The path filters decide which jobs run, and list themselves in every group so
  // that a change to them runs every gated job: CI wiring, like ci.yml.
  '.github/filters/',
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
  'apps/web/vitest.escape-glob.ts',
  'apps/web/vitest.experience-runner.config.ts',
  'apps/web/vitest.jsdom-holdouts.ts',
  'apps/web/vitest.next-image-mock.ts',
  'apps/web/vitest.node-folders.ts',
  'apps/web/vitest.sequencer.ts',
  'apps/web/vitest.setup.node.ts',
  'apps/web/vitest.setup.shared.ts',
  'apps/web/vitest.setup.ts',
  'apps/web/vitest.slow-test-files.ts',
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

/** True for a file whose change always keeps the full affected test path. */
export function isFullAffectedTrigger(file) {
  return (
    ROOT_FULL_TEST_FILES.has(file) ||
    WEB_FULL_TEST_FILES.has(file) ||
    MOBILE_STOREFRONT_FULL_TEST_FILES.has(file) ||
    ROOT_FULL_TEST_PREFIXES.some((prefix) => file.startsWith(prefix)) ||
    isSharedConfigFile(file)
  );
}

export {
  changedFilesDiffArgs,
  getChangedFiles,
  getDeletedFiles,
} from './resolve-ci-test-plan-git.mjs';

function normalizeChangedFile(file) {
  return file
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\.\/+/, '');
}

function targetedWebCommand(baseRef) {
  return `pnpm --filter @baci/web exec vitest run --changed ${baseRef} --passWithNoTests`;
}

function targetedMobileStorefrontCommand(baseRef) {
  return `pnpm --filter @baci/mobile-storefront exec jest --changedSince ${baseRef} --runInBand --passWithNoTests`;
}

function fullAffectedPlan(reason) {
  return { mode: 'full-affected', reason, command: FULL_AFFECTED_COMMAND };
}

/**
 * Picks the tests a CI run executes. Only listed classes of files get a targeted
 * plan; an unknown path, a full trigger, a non-pull-request event or an empty
 * diff keeps the full affected test path. `changedFiles` includes deletions and
 * the old side of a rename; `deletedFiles` is the part that no longer exists
 * (`null` when it could not be read);
 * `nonWebReaders` are tests outside apps/web that name a changed data file
 * (`null` when that search failed).
 */
export function resolveCiTestPlan({
  baseRef,
  changedFileContents = {},
  changedFiles,
  deletedFiles = [],
  eventName,
  nonWebReaders = [],
}) {
  const normalizedFiles = changedFiles
    .map(normalizeChangedFile)
    .filter(Boolean);

  if (eventName !== 'pull_request') {
    return fullAffectedPlan(
      'Non-pull-request events keep the full affected test path.'
    );
  }

  if (normalizedFiles.length === 0) {
    return fullAffectedPlan(
      'No changed files were detected, so CI keeps the safer full affected test path.'
    );
  }

  const safeConfigFiles = normalizedFiles.filter((file) =>
    ciTestPlanConfig.isSafeConfigSmokeChange(file, changedFileContents)
  );
  const scopedFiles = normalizedFiles.filter(
    (file) => !safeConfigFiles.includes(file)
  );

  if (safeConfigFiles.length === normalizedFiles.length) {
    return {
      mode: 'config-smoke',
      reason:
        'Pull request changes only add Turbo build environment allowlist entries.',
      command: ciTestPlanConfig.CONFIG_SMOKE_COMMAND,
    };
  }

  if (scopedFiles.some(isFullAffectedTrigger)) {
    return fullAffectedPlan(
      'Shared, package, CI, or test setup changes require the full affected test path.'
    );
  }

  if (deletedFiles === null) {
    return fullAffectedPlan(DELETED_UNKNOWN_REASON);
  }
  if (deletedFiles.map(normalizeChangedFile).some(isDeletedSourceFile)) {
    return fullAffectedPlan(DELETED_SOURCE_REASON);
  }

  const webFiles = scopedFiles.filter(isTargetableWebFile);
  const storefrontFiles = scopedFiles.filter(
    (file) =>
      !isTargetableWebFile(file) && isTargetableMobileStorefrontFile(file)
  );
  // Data files that tests read through fs. They run through the web Vitest
  // command, whose changed-files provider adds the tests that mention them
  // (it does this for any changed file in these families, wherever it lives).
  const readerFiles = scopedFiles.filter(isFsReaderFile);

  // Unknown paths keep the full suite: only listed classes may skip it.
  const hasUnknownFiles = scopedFiles.some(
    (file) =>
      !isTargetableWebFile(file) &&
      !isTargetableMobileStorefrontFile(file) &&
      !isFsReaderFile(file)
  );
  if (hasUnknownFiles) {
    return fullAffectedPlan(
      'The diff includes files outside the targeted web test scope.'
    );
  }
  // A fixture in the source folders is never traced to the tests that read it:
  // next to files outside those folders the full suite covers it, as it did before.
  if (keepsFullForSourceData(scopedFiles)) {
    return fullAffectedPlan(SOURCE_DATA_REASON);
  }

  const runsWebTests = webFiles.length > 0 || readerFiles.length > 0;
  const runsStorefrontTests = storefrontFiles.length > 0;
  const hasReaderFiles = readerFiles.length > 0;

  if (hasReaderFiles && nonWebReaders === null) {
    return fullAffectedPlan(READER_SEARCH_FAILED_REASON);
  }
  if (hasReaderFiles && nonWebReaders.length > 0) {
    return fullAffectedPlan(
      `${NON_WEB_READER_REASON} ${nonWebReaders.slice(0, 3).map(singleLine).join(', ')}`
    );
  }

  if (runsStorefrontTests && hasReaderFiles) {
    return fullAffectedPlan(STOREFRONT_READER_REASON);
  }

  if (runsWebTests && runsStorefrontTests) {
    return {
      mode: 'targeted-web-and-storefront-tests',
      reason: WEB_AND_STOREFRONT_REASON,
      command: `${targetedWebCommand(baseRef)} && ${targetedMobileStorefrontCommand(baseRef)}`,
    };
  }

  if (runsWebTests) {
    return {
      mode: 'targeted-web-vitest',
      reason: hasReaderFiles ? WEB_READER_REASON : WEB_SOURCE_REASON,
      command: targetedWebCommand(baseRef),
    };
  }

  return {
    mode: 'targeted-storefront-jest',
    reason: STOREFRONT_REASON,
    command: targetedMobileStorefrontCommand(baseRef),
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const changedFiles = getChangedFiles(args.baseRef, args.headRef);
  const deletedFiles = getDeletedFiles(args.baseRef, args.headRef);
  const changedFileContents = ciTestPlanConfig.getChangedFileContents(
    changedFiles,
    args.baseRef,
    args.headRef
  );
  let nonWebReaders = null;
  try {
    nonWebReaders = findNonWebReaders(changedFiles);
  } catch (error) {
    console.error(`CI test planner: reader search failed: ${error.message}`);
  }
  const plan = resolveCiTestPlan({
    baseRef: args.baseRef,
    changedFileContents,
    changedFiles,
    deletedFiles,
    eventName: args.eventName,
    nonWebReaders,
  });

  console.log(`CI test plan: ${plan.mode}`);
  console.log(plan.reason);
  console.log(plan.command);
  writeGithubOutput(plan);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
