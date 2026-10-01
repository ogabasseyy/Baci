import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { eventPipelineBoundaryManifest } from '../../src/lib/events/event-pipeline-boundary-manifest';
import { collectProductionImportClosure } from '../../src/lib/events/event-pipeline-import-closure';
import { analyticsDeliveryAuthorityManifest } from './analytics-delivery-authority-manifest';
import { readGitIndexSources } from './event-pipeline-git-content';
import { readGitSourceSnapshot } from './event-pipeline-git-source-snapshot';
import { eventPipelineSourceFilePolicy } from './event-pipeline-source-file-policy';

const FROZEN_EVENT_PIPELINE_BASE_SHA =
  'cfe0e9864cd776af98ef400969257e2ec147f65d';
// Keep this on a landing ancestor: squash merges do not preserve PR-only
// review-fix commits. Changed inherited routes use content receipts instead of
// a baseline commit so the check remains valid after the squash.
const FROZEN_EVENT_PIPELINE_AUTHORITY_BYTE_BASE_SHA =
  'cc3557aa5556db17131b0b66f72087e10794791b';
const FROZEN_PATH_INVENTORY_SHA256 =
  '8a0f0b5e61d39fe46144e0114a41c7e25a8501e756ce1b819cca5fb793c6d0dc';
const retiredPlatformAuthorityHelperPath =
  analyticsDeliveryAuthorityManifest.retiredPlatformAuthority.helper;
const explicitlyGuardedAuthorityPaths = new Set([
  ...Object.keys(analyticsDeliveryAuthorityManifest.authorityClosureHashes),
  ...Object.keys(analyticsDeliveryAuthorityManifest.callerScopedRouteHashes),
  ...Object.keys(
    analyticsDeliveryAuthorityManifest.verifiedContextHelperHashes
  ),
  analyticsDeliveryAuthorityManifest.platformRouteHash.path,
  // The retired helper is excluded from inherited byte freezing only because
  // analytics authority checks require it and its importers to remain absent.
  retiredPlatformAuthorityHelperPath,
]);

function repoRoot(): string {
  return execFileSync('git', ['rev-parse', '--show-toplevel'], {
    encoding: 'utf8',
  }).trim();
}

function gitPaths(root: string, args: readonly string[]): string[] {
  return execFileSync('git', [...args], { cwd: root, encoding: 'utf8' })
    .split('\0')
    .filter(Boolean);
}

function sourcePaths(root: string): string[] {
  return gitPaths(root, [
    'ls-files',
    '-co',
    '--exclude-standard',
    '-z',
    '--',
    ...eventPipelineSourceFilePolicy.pathspecs,
  ]);
}

function collect(
  root = repoRoot(),
  sources = readGitSourceSnapshot(root).sources,
  frozenBaseSha = FROZEN_EVENT_PIPELINE_BASE_SHA
) {
  const fixtureRelativePath =
    'apps/web/tools/events/fixtures/event-pipeline-path-inventory.tsv';
  const fixturePath = resolve(root, fixtureRelativePath);
  const fixtureSource = readFileSync(fixturePath, 'utf8');
  const fixtureInventorySha256 = createHash('sha256')
    .update(fixtureSource)
    .digest('hex');
  const fixtureIndexSource = readGitIndexSources(root, [
    fixtureRelativePath,
  ]).get(fixtureRelativePath);
  const fixtureIndexSha256 = fixtureIndexSource
    ? createHash('sha256').update(fixtureIndexSource).digest('hex')
    : undefined;
  const fixtureRecords = fixtureSource.trimEnd().split('\n');
  const fixturePaths = fixtureRecords.map((line) => line.split('\t')[1] ?? '');
  const productionClosure = collectProductionImportClosure(
    eventPipelineBoundaryManifest.productionRoots,
    sources
  );
  const dynamicPaths = [
    ...gitPaths(root, [
      'diff',
      '--name-only',
      '-z',
      `${frozenBaseSha}...HEAD`,
      '--',
    ]),
    ...gitPaths(root, ['diff', '--cached', '--name-only', '-z', '--']),
    ...gitPaths(root, ['diff', '--name-only', '-z', '--']),
    ...gitPaths(root, [
      'ls-files',
      '--others',
      '--exclude-standard',
      '-z',
      '--',
    ]),
  ];
  return {
    changedPaths: dynamicPaths,
    fixtureInventoryHashMatches:
      fixtureInventorySha256 === FROZEN_PATH_INVENTORY_SHA256 &&
      fixtureIndexSha256 === FROZEN_PATH_INVENTORY_SHA256,
    fixtureInventorySha256,
    fixtureRecordCount: fixtureRecords.length,
    frozenBaseSha,
    missingProductionRoots:
      eventPipelineBoundaryManifest.productionRoots.filter(
        (path) => !sources.has(path)
      ),
    paths: [...new Set([...productionClosure, ...dynamicPaths])]
      .filter(eventPipelineSourceFilePolicy.isSourcePath)
      .filter((path) => !path.endsWith('/supabase/.temp/cli-latest'))
      .sort(),
    productionPaths: [...productionClosure]
      .filter(eventPipelineSourceFilePolicy.isSourcePath)
      .sort(),
    seedPaths: fixturePaths.filter(eventPipelineSourceFilePolicy.isSourcePath),
  };
}

export const eventPipelineGovernedPaths = {
  authorityByteBaseSha: FROZEN_EVENT_PIPELINE_AUTHORITY_BYTE_BASE_SHA,
  collect,
  explicitlyGuardedAuthorityPaths,
  retiredPlatformAuthorityHelperPath,
  repoRoot,
  sourcePaths,
} as const;
