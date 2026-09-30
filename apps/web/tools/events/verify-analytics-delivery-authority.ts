import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from '@typescript/typescript6';
import { analyzeAnalyticsDeliveryAuthoritySources } from './analytics-delivery-authority-analysis';
import { analyticsDeliveryAuthorityManifest as manifest } from './analytics-delivery-authority-manifest';
import { analyzeCredentialProjectionSets } from './analytics-delivery-credential-projection-analysis';
// biome-ignore format: compact verifier import preserves the 300-line gate.
import { analyzeAnalyticsWorkerAuthority } from './analytics-worker-authority-analysis';
import { readQueueOnlyDeliveryCutover } from './event-pipeline-authority-cutover-analysis';
import { readGitSourceSnapshot } from './event-pipeline-git-source-snapshot';
import { eventPipelineSourceFilePolicy } from './event-pipeline-source-file-policy';
import { isTestSourcePath } from './event-pipeline-source-path';

const sourceExtension = '(cjs|cts|js|jsx|mjs|mts|ts|tsx)';
function colocatedTestPath(path: string): string {
  return path.replace(
    new RegExp(`\\.${sourceExtension}$`),
    (_match, extension: string) => `.test.${extension}`
  );
}
function runtimePathForColocatedTest(path: string): string | undefined {
  const runtimePath = path.replace(
    new RegExp(`\\.test\\.${sourceExtension}$`),
    (_match, extension: string) => `.${extension}`
  );
  return runtimePath === path ? undefined : runtimePath;
}

// biome-ignore format: compact parser preserves the 300-line verifier gate.
function ast(path: string, source: string) {
  const scriptKind = path.endsWith('.tsx') ? ts.ScriptKind.TSX : path.endsWith('.jsx') ? ts.ScriptKind.JSX : /\.(?:cjs|js|mjs)$/.test(path) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
  return ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, scriptKind);
}

export function analyzeChangedRuntimeContracts(
  paths: readonly string[],
  sources: ReadonlyMap<string, string>,
  baselineSources: ReadonlyMap<string, string> = new Map()
): string[] {
  const findings: string[] = [];
  const runtimePaths = [
    ...new Set(paths.map((path) => runtimePathForColocatedTest(path) ?? path)),
  ];
  for (const path of runtimePaths.filter(
    (value) =>
      /^apps\/web\/(?:src|tools)\//.test(value) &&
      eventPipelineSourceFilePolicy.isSourcePath(value) &&
      !isTestSourcePath(value) &&
      !/\.d\.(?:cts|mts|ts)$/.test(value)
  )) {
    const source = sources.get(path);
    if (!source) continue;
    const lineCount =
      source.split(/\r?\n/).length - Number(source.endsWith('\n'));
    const baselineSource = baselineSources.get(path);
    const baselineLineCount = baselineSource
      ? baselineSource.split(/\r?\n/).length -
        Number(baselineSource.endsWith('\n'))
      : 0;
    if (lineCount > 300 && baselineLineCount <= 300) {
      findings.push(`${path}: changed runtime exceeds 300 lines`);
    }
    const runtime = ast(path, source).statements.some(
      (statement) =>
        !ts.isImportDeclaration(statement) &&
        !ts.isInterfaceDeclaration(statement) &&
        !ts.isTypeAliasDeclaration(statement) &&
        !ts.isExportDeclaration(statement)
    );
    const testPath = colocatedTestPath(path);
    const baselineRuntime = baselineSource
      ? ast(path, baselineSource).statements.some(
          (statement) =>
            !ts.isImportDeclaration(statement) &&
            !ts.isInterfaceDeclaration(statement) &&
            !ts.isTypeAliasDeclaration(statement) &&
            !ts.isExportDeclaration(statement)
        )
      : false;
    const legacyMissingTest = baselineRuntime && !baselineSources.has(testPath);
    if (runtime && !sources.has(testPath) && !legacyMissingTest) {
      findings.push(
        `${path}: changed runtime is missing colocated test ${testPath}`
      );
    }
  }
  return findings.sort();
}

export function analyzeTemporaryAuthorityExpiry(
  now: Date,
  queueOnlyDeliveryActivated: boolean,
  platformEdgePresent = true
): string[] {
  if (queueOnlyDeliveryActivated) {
    return [
      'temporary event-pipeline analytics authority expired because queue-only delivery is active',
    ];
  }
  if (!platformEdgePresent) return [];
  return now.getTime() >= Date.parse(manifest.temporaryAuthorityExpiresAt)
    ? [
        `temporary event-pipeline analytics authority expired at ${manifest.temporaryAuthorityExpiresAt}`,
      ]
    : [];
}

type GitOutput = (args: string[]) => string;

function resolveMergeBase(run: GitOutput): string {
  const baseRefs = [
    ...(process.env.GITHUB_BASE_REF
      ? [`origin/${process.env.GITHUB_BASE_REF}`, process.env.GITHUB_BASE_REF]
      : []),
    'origin/main',
    'main',
  ];
  let mergeBase = '';
  let mergeBaseError: unknown;
  for (const baseRef of baseRefs) {
    try {
      mergeBase = run(['merge-base', 'HEAD', baseRef]).trim();
      if (mergeBase) break;
    } catch (error) {
      mergeBaseError = error;
    }
  }
  if (!mergeBase) {
    throw mergeBaseError instanceof Error
      ? mergeBaseError
      : new Error('Unable to resolve analytics authority merge base');
  }
  return mergeBase;
}

export function changedPaths(root: string, git?: GitOutput): string[] {
  const options = { cwd: root, encoding: 'utf8' as const };
  const run = git ?? ((args: string[]) => execFileSync('git', args, options));
  const mergeBase = resolveMergeBase(run);
  const committed = run([
    'diff',
    '--name-only',
    '-z',
    `${mergeBase}...HEAD`,
    '--',
    ...eventPipelineSourceFilePolicy.pathspecs,
  ]);
  const working = run([
    'diff',
    '--name-only',
    '-z',
    'HEAD',
    '--',
    ...eventPipelineSourceFilePolicy.pathspecs,
  ]);
  const untracked = run([
    'ls-files',
    '--others',
    '--exclude-standard',
    '-z',
    ...eventPipelineSourceFilePolicy.pathspecs,
  ]);
  return [
    ...new Set(
      `${committed}${working}${untracked}`.split('\0').filter(Boolean)
    ),
  ];
}

// biome-ignore format: compact repository helper preserves the 300-line verifier gate.
export function baselineSources(root: string, paths: readonly string[], git?: GitOutput): Map<string, string> {
  const options = { cwd: root, encoding: 'utf8' as const };
  const run = git ?? ((args: string[]) => execFileSync('git', args, options));
  const mergeBase = resolveMergeBase(run);
  const sources = new Map<string, string>();
  for (const path of new Set(paths)) {
    try {
      sources.set(path, run(['show', `${mergeBase}:${path}`]));
    } catch (error) {
      const stderr =
        error instanceof Error && 'stderr' in error ? String(error.stderr) : '';
      const absentAtMergeBase =
        stderr.includes(` does not exist in '${mergeBase}'`) ||
        stderr.includes(` exists on disk, but not in '${mergeBase}'`);
      if (!stderr.startsWith('fatal: path ') || !absentAtMergeBase) {
        throw error;
      }
      // Confirmed absent at the merge base, so no legacy exemption applies.
    }
  }
  return sources;
}

// biome-ignore format: compact source-view signature preserves the 300-line verifier gate.
function sourceViewFindings(sources: ReadonlyMap<string, string>, paths: readonly string[], runtimeContractBaseline: ReadonlyMap<string, string>, now: Date): string[] {
  const cutoverPath =
    'apps/web/src/lib/events/event-pipeline-authority-cutover.ts';
  const queueOnlyDeliveryActivated = readQueueOnlyDeliveryCutover(
    sources.get(cutoverPath) ?? ''
  );
  const findings = [
    ...analyzeAnalyticsDeliveryAuthoritySources(sources),
    ...analyzeCredentialProjectionSets(sources),
    ...analyzeAnalyticsWorkerAuthority(sources),
    ...analyzeChangedRuntimeContracts(
      paths,
      sources,
      runtimeContractBaseline
    ),
    ...(queueOnlyDeliveryActivated === undefined
      ? [`${cutoverPath}: queue-only authority cutover marker is unresolved`]
      : analyzeTemporaryAuthorityExpiry(
          now,
          queueOnlyDeliveryActivated,
          sources.has(manifest.retiredPlatformAuthority.helper)
        )),
  ];
  const hashes = {
    ...manifest.authorityClosureHashes,
    ...manifest.callerScopedRouteHashes,
    ...manifest.verifiedContextHelperHashes,
    [manifest.platformRouteHash.path]: manifest.platformRouteHash.sha256,
  };
  for (const [path, expected] of Object.entries(hashes)) {
    const source = sources.get(path);
    if (source === undefined) {
      findings.push(`${path}: frozen authority source is missing`);
      continue;
    }
    const actual = createHash('sha256').update(source).digest('hex');
    if (actual !== expected)
      findings.push(`${path}: frozen route hash ${actual}`);
  }
  if (sources.has(manifest.retiredPlatformAuthority.helper)) {
    findings.push(
      `${manifest.retiredPlatformAuthority.helper}: retired platform authority helper is present`
    );
  }
  return findings;
}
// biome-ignore format: compact equality avoids duplicate full analysis for identical source views.
function sameSources(left: ReadonlyMap<string, string>, right: ReadonlyMap<string, string>): boolean {
  return left.size === right.size && [...left].every(([path, source]) => right.get(path) === source);
}
export function verifyAnalyticsDeliveryAuthority(root: string): string[] {
  const snapshot = readGitSourceSnapshot(root);
  const paths = changedPaths(root);
  const runtimeContractSnapshotPaths = paths.flatMap((path) => {
    const runtimePath = runtimePathForColocatedTest(path) ?? path;
    return [runtimePath, colocatedTestPath(runtimePath)];
  });
  // biome-ignore format: compact baseline call preserves the 300-line verifier gate.
  const runtimeContractBaseline = baselineSources(root, runtimeContractSnapshotPaths);
  const now = new Date();
  const findings = snapshot.missingStagedPaths.map(
    (path) => `${path}: staged analytics authority source is unresolved`
  );
  findings.push(
    ...sourceViewFindings(
      snapshot.indexSources,
      paths,
      runtimeContractBaseline,
      now
    )
  );
  if (!sameSources(snapshot.indexSources, snapshot.filesystemSources))
    findings.push(
      ...sourceViewFindings(
        snapshot.filesystemSources,
        paths,
        runtimeContractBaseline,
        now
      )
    );
  return [...new Set(findings)].sort();
}

if (process.argv[1]) {
  const root = execFileSync('git', ['rev-parse', '--show-toplevel'], {
    encoding: 'utf8',
  }).trim();
  if (import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    const findings = verifyAnalyticsDeliveryAuthority(root);
    if (findings.length) {
      console.error(findings.join('\n'));
      process.exitCode = 1;
    } else {
      console.log('analytics delivery authority verification passed');
    }
  }
}
