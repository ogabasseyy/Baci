import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { ciTestPlanConfig } from './resolve-ci-test-plan-config.mjs';
import {
  isFsReaderFile,
  isFullAffectedTrigger,
  isTargetableMobileStorefrontFile,
  isTargetableWebFile,
} from './resolve-ci-test-plan-paths.mjs';

const FULL_AFFECTED_COMMAND =
  'pnpm turbo run test --concurrency=3 --log-order=stream';

const WEB_SOURCE_REASON =
  'Pull request changes are limited to apps/web source or test files.';
const WEB_READER_REASON =
  'Pull request changes are limited to apps/web source or test files and files that tests read; the Vitest changed-files provider adds the tests that read them.';
const WEB_AND_STOREFRONT_REASON =
  'Pull request changes are limited to apps/web and mobile storefront source or test files.';
const WEB_AND_STOREFRONT_READER_REASON =
  'Pull request changes are limited to apps/web and mobile storefront source or test files and files that tests read; the Vitest changed-files provider adds the tests that read them.';
const STOREFRONT_REASON =
  'Pull request changes are limited to mobile storefront source or test files.';

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

export function resolveCiTestPlan({
  baseRef,
  changedFileContents = {},
  changedFiles,
  eventName,
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

  const runsWebTests = webFiles.length > 0 || readerFiles.length > 0;
  const runsStorefrontTests = storefrontFiles.length > 0;
  const hasReaderFiles = readerFiles.length > 0;

  if (runsWebTests && runsStorefrontTests) {
    return {
      mode: 'targeted-web-and-storefront-tests',
      reason: hasReaderFiles
        ? WEB_AND_STOREFRONT_READER_REASON
        : WEB_AND_STOREFRONT_REASON,
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

function parseArgs(argv) {
  const args = {
    baseRef: 'origin/main',
    eventName: process.env.GITHUB_EVENT_NAME ?? 'pull_request',
    headRef: 'HEAD',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--base') {
      args.baseRef = argv[index + 1] ?? args.baseRef;
      index += 1;
    } else if (arg === '--event') {
      args.eventName = argv[index + 1] ?? args.eventName;
      index += 1;
    } else if (arg === '--head') {
      args.headRef = argv[index + 1] ?? args.headRef;
      index += 1;
    }
  }

  return args;
}

// Deleted files and both sides of a rename are real changes: a PR that deletes
// a shared file, or moves it out of a package, can break tests that still
// import it. `--no-renames` lists the old path of a rename as a deletion, and
// the absence of a `--diff-filter` keeps deletions in the list.
export function changedFilesDiffArgs(baseRef, headRef) {
  return ['diff', '--name-only', '--no-renames', `${baseRef}...${headRef}`];
}

export function getChangedFiles(baseRef, headRef, { cwd } = {}) {
  try {
    return execFileSync('git', changedFilesDiffArgs(baseRef, headRef), {
      cwd,
      encoding: 'utf8',
    })
      .split('\n')
      .filter(Boolean);
  } catch {
    return [];
  }
}

function writeGithubOutput(plan) {
  if (!process.env.GITHUB_OUTPUT) {
    return;
  }

  appendFileSync(
    process.env.GITHUB_OUTPUT,
    `mode=${plan.mode}\nreason=${plan.reason}\ncommand=${plan.command}\n`
  );
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const changedFiles = getChangedFiles(args.baseRef, args.headRef);
  const changedFileContents = ciTestPlanConfig.getChangedFileContents(
    changedFiles,
    args.baseRef,
    args.headRef
  );
  const plan = resolveCiTestPlan({
    baseRef: args.baseRef,
    changedFileContents,
    changedFiles,
    eventName: args.eventName,
  });

  console.log(`CI test plan: ${plan.mode}`);
  console.log(plan.reason);
  console.log(plan.command);
  writeGithubOutput(plan);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
