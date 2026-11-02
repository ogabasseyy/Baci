import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { ciTestPlanConfig } from './resolve-ci-test-plan-config.mjs';

const FULL_AFFECTED_COMMAND =
  'pnpm turbo run test --concurrency=3 --log-order=stream';

const ROOT_FULL_TEST_FILES = new Set([
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

const ROOT_FULL_TEST_PREFIXES = [
  '.github/actions/',
  'packages/shared/',
  'tsconfig',
];

// Plain-text lists read through fs: `vitest --changed` cannot map them to the
// tests that consume them, so a targeted run would skip their validation.
const WEB_FULL_TEST_PREFIXES = ['apps/web/tools/db/replay-registry/'];

const WEB_FULL_TEST_FILES = new Set([
  'apps/web/jest.config.mjs',
  'apps/web/jest.setup.js',
  'apps/web/next.config.test.ts',
  'apps/web/next.config.ts',
  'apps/web/package.json',
  'apps/web/tsconfig.json',
  'apps/web/vitest.config.ts',
  'apps/web/vitest.setup.ts',
]);

const MOBILE_STOREFRONT_FULL_TEST_FILES = new Set([
  'apps/mobile-storefront/app.config.ts',
  'apps/mobile-storefront/babel.config.js',
  'apps/mobile-storefront/jest.config.js',
  'apps/mobile-storefront/jest.setup.ts',
  'apps/mobile-storefront/metro.config.js',
  'apps/mobile-storefront/package.json',
  'apps/mobile-storefront/tsconfig.json',
]);

const WEB_TARGETED_PREFIXES = [
  'apps/web/mcp-server/',
  'apps/web/src/',
  'apps/web/tools/',
];

const MOBILE_STOREFRONT_TARGETED_PREFIXES = [
  'apps/mobile-storefront/app/',
  'apps/mobile-storefront/components/',
  'apps/mobile-storefront/constants/',
  'apps/mobile-storefront/hooks/',
  'apps/mobile-storefront/lib/',
  'apps/mobile-storefront/schemas/',
  'apps/mobile-storefront/services/',
  'apps/mobile-storefront/stores/',
];

function normalizeChangedFile(file) {
  return file.trim().replace(/\\/g, '/').replace(/^\.\/+/, '');
}

function isFullAffectedTrigger(file) {
  if (
    ROOT_FULL_TEST_FILES.has(file) ||
    WEB_FULL_TEST_FILES.has(file) ||
    MOBILE_STOREFRONT_FULL_TEST_FILES.has(file)
  ) {
    return true;
  }

  return [...ROOT_FULL_TEST_PREFIXES, ...WEB_FULL_TEST_PREFIXES].some(
    (prefix) => file.startsWith(prefix)
  );
}

function isTargetableWebFile(file) {
  return WEB_TARGETED_PREFIXES.some((prefix) => file.startsWith(prefix));
}

function isTargetableMobileStorefrontFile(file) {
  return MOBILE_STOREFRONT_TARGETED_PREFIXES.some((prefix) =>
    file.startsWith(prefix)
  );
}

function targetedWebCommand(baseRef) {
  return `pnpm --filter @baci/web exec vitest run --changed ${baseRef} --passWithNoTests`;
}

function targetedMobileStorefrontCommand(baseRef) {
  return `pnpm --filter @baci/mobile-storefront exec jest --changedSince ${baseRef} --runInBand --passWithNoTests`;
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
    return {
      mode: 'full-affected',
      reason: 'Non-pull-request events keep the full affected test path.',
      command: FULL_AFFECTED_COMMAND,
    };
  }

  if (normalizedFiles.length === 0) {
    return {
      mode: 'full-affected',
      reason: 'No changed files were detected, so CI keeps the safer full affected test path.',
      command: FULL_AFFECTED_COMMAND,
    };
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
    return {
      mode: 'full-affected',
      reason: 'Shared, package, CI, or test setup changes require the full affected test path.',
      command: FULL_AFFECTED_COMMAND,
    };
  }

  const hasTargetableWebFiles = scopedFiles.some(isTargetableWebFile);
  const hasTargetableMobileStorefrontFiles = scopedFiles.some(
    isTargetableMobileStorefrontFile
  );
  const allFilesAreTargetable = scopedFiles.every(
    (file) => isTargetableWebFile(file) || isTargetableMobileStorefrontFile(file)
  );

  if (allFilesAreTargetable && hasTargetableWebFiles) {
    if (hasTargetableMobileStorefrontFiles) {
      return {
        mode: 'targeted-web-and-storefront-tests',
        reason:
          'Pull request changes are limited to apps/web and mobile storefront source or test files.',
        command: `${targetedWebCommand(baseRef)} && ${targetedMobileStorefrontCommand(baseRef)}`,
      };
    }

    return {
      mode: 'targeted-web-vitest',
      reason: 'Pull request changes are limited to apps/web source or test files.',
      command: targetedWebCommand(baseRef),
    };
  }

  if (allFilesAreTargetable && hasTargetableMobileStorefrontFiles) {
    return {
      mode: 'targeted-storefront-jest',
      reason:
        'Pull request changes are limited to mobile storefront source or test files.',
      command: targetedMobileStorefrontCommand(baseRef),
    };
  }

  return {
    mode: 'full-affected',
    reason: 'The diff includes files outside the targeted web test scope.',
    command: FULL_AFFECTED_COMMAND,
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

function getChangedFiles(baseRef, headRef) {
  try {
    return execFileSync(
      'git',
      [
        'diff',
        '--name-only',
        '--diff-filter=ACMRTUXB',
        `${baseRef}...${headRef}`,
      ],
      { encoding: 'utf8' }
    )
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
