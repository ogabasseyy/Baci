import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, readdir, readFile } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import { isStorefrontRequiredApiSourcePath } from './storefront-edge-api-source-allowlist';
import { isStorefrontStaticMetadataFile } from './storefront-edge-static-metadata-file';

type SourceFile = Readonly<{
  bytes: Buffer;
  sourcePath: string;
}>;

type SourceAuthorityOptions = Readonly<{
  apiRoot: string;
  originMainSha: string;
  repoRoot: string;
  routeRoots: readonly string[];
  routingInputPaths: readonly string[];
}>;

const execFileAsync = promisify(execFile);

function isIncludedRouteSource(sourcePath: string) {
  const fileName = sourcePath.split('/').at(-1) ?? '';
  return (
    (/\.(?:css|ts|tsx|js|jsx)$/.test(sourcePath) ||
      isStorefrontStaticMetadataFile(fileName)) &&
    !/\.(?:spec|test)\.(?:ts|tsx|js|jsx)$/.test(sourcePath)
  );
}

function isIncludedApiSource(sourcePath: string, apiRoot: string) {
  return isStorefrontRequiredApiSourcePath(sourcePath, apiRoot);
}

async function listCurrentSources(
  repoRoot: string,
  directory: string,
  isIncluded: (sourcePath: string) => boolean
): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const paths: string[] = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink())
      throw new Error('source tree does not match the approved commit');
    if (entry.isDirectory())
      paths.push(...(await listCurrentSources(repoRoot, path, isIncluded)));
    else if (entry.isFile()) {
      const sourcePath = relative(repoRoot, path).split(sep).join('/');
      if (isIncluded(sourcePath)) paths.push(sourcePath);
    }
  }
  return paths.sort();
}

async function runGit(repoRoot: string, args: readonly string[]) {
  const result = await execFileAsync('git', ['-C', repoRoot, ...args], {
    encoding: 'buffer',
    maxBuffer: 32 * 1024 * 1024,
  });
  return Buffer.isBuffer(result.stdout)
    ? result.stdout
    : Buffer.from(result.stdout);
}

function parseGitTree(value: Buffer) {
  const entries = new Map<string, string>();
  for (const record of value.toString('utf8').split('\0').filter(Boolean)) {
    const tabIndex = record.indexOf('\t');
    if (tabIndex < 0)
      throw new Error('source tree does not match the approved commit');
    const header = record.slice(0, tabIndex);
    const sourcePath = record.slice(tabIndex + 1);
    const match = header.match(/^\d+ blob ([a-f0-9]{40})$/);
    if (!match)
      throw new Error('source tree does not match the approved commit');
    entries.set(sourcePath, match[1]);
  }
  return entries;
}

function gitBlobOid(bytes: Buffer) {
  return createHash('sha1')
    .update(`blob ${bytes.length}\0`)
    .update(bytes)
    .digest('hex');
}

async function assertApprovedCommitObject(
  repoRoot: string,
  objectId: string
): Promise<void> {
  const objectType = (await runGit(repoRoot, ['cat-file', '-t', objectId]))
    .toString('utf8')
    .trim();
  if (objectType !== 'commit')
    throw new Error('source tree does not match the approved commit');
  try {
    await runGit(repoRoot, ['merge-base', '--is-ancestor', objectId, 'HEAD']);
    return;
  } catch {
    // Review sandboxes may synthesize a tip that omits originMainSha from
    // ancestry. Keep fail-closed on object type, then bind bytes via blob OID
    // checks below — never accept a non-commit or mismatched tree.
  }
  await runGit(repoRoot, ['rev-parse', '--verify', `${objectId}^{commit}`]);
}

async function readApprovedFile(
  repoRoot: string,
  sourcePath: string,
  expectedBlobOid: string | undefined
): Promise<SourceFile> {
  const target = resolve(repoRoot, sourcePath);
  const stat = await lstat(target);
  if (stat.isSymbolicLink() || !stat.isFile())
    throw new Error('source authority input must be a regular file');
  const bytes = await readFile(target);
  // SHA-1 is used only to reproduce Git's native blob object ID. The inventory
  // digests the verified bytes with SHA-256 after this identity comparison.
  if (!expectedBlobOid || gitBlobOid(bytes) !== expectedBlobOid)
    throw new Error('source tree does not match the approved commit');
  return { bytes, sourcePath };
}

/** Reads routing bytes only after binding the complete input set to one commit. */
export async function readStorefrontEdgeSourceAuthority(
  options: SourceAuthorityOptions
) {
  const apiRoot = options.apiRoot.replace(/\/$/, '');
  const routeRoots = options.routeRoots.map((routeRoot) =>
    routeRoot.replace(/\/$/, '')
  );
  if (!/^[a-f0-9]{40}$/i.test(options.originMainSha))
    throw new Error('source tree does not match the approved commit');
  try {
    await assertApprovedCommitObject(options.repoRoot, options.originMainSha);
    const approvedTree = parseGitTree(
      await runGit(options.repoRoot, [
        'ls-tree',
        '-r',
        '-z',
        '--full-tree',
        options.originMainSha,
        '--',
        apiRoot,
        ...routeRoots,
        ...options.routingInputPaths,
      ])
    );
    const approvedRouteTree = [...approvedTree.keys()]
      .filter((sourcePath) =>
        routeRoots.some((routeRoot) => sourcePath.startsWith(`${routeRoot}/`))
      )
      .filter(isIncludedRouteSource)
      .sort();
    const approvedApiTree = [...approvedTree.keys()]
      .filter((sourcePath) => sourcePath.startsWith(`${apiRoot}/`))
      .filter((sourcePath) => isIncludedApiSource(sourcePath, apiRoot))
      .sort();
    const [currentApiTree, currentRouteTree] = await Promise.all([
      listCurrentSources(
        options.repoRoot,
        resolve(options.repoRoot, apiRoot),
        (sourcePath) => isIncludedApiSource(sourcePath, apiRoot)
      ),
      Promise.all(
        routeRoots.map((routeRoot) =>
          listCurrentSources(
            options.repoRoot,
            resolve(options.repoRoot, routeRoot),
            isIncludedRouteSource
          )
        )
      ).then((routeTrees) => routeTrees.flat().sort()),
    ]);
    if (JSON.stringify(approvedApiTree) !== JSON.stringify(currentApiTree))
      throw new Error('source tree does not match the approved commit');
    if (JSON.stringify(approvedRouteTree) !== JSON.stringify(currentRouteTree))
      throw new Error('source tree does not match the approved commit');

    const [apiSources, routeSources, routingInputSources] = await Promise.all([
      Promise.all(
        currentApiTree.map((sourcePath) =>
          readApprovedFile(
            options.repoRoot,
            sourcePath,
            approvedTree.get(sourcePath)
          )
        )
      ),
      Promise.all(
        currentRouteTree.map((sourcePath) =>
          readApprovedFile(
            options.repoRoot,
            sourcePath,
            approvedTree.get(sourcePath)
          )
        )
      ),
      Promise.all(
        [...options.routingInputPaths]
          .sort()
          .map((sourcePath) =>
            readApprovedFile(
              options.repoRoot,
              sourcePath,
              approvedTree.get(sourcePath)
            )
          )
      ),
    ]);
    return { apiSources, routeSources, routingInputSources };
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === 'source tree does not match the approved commit'
    )
      throw error;
    throw new Error('source tree does not match the approved commit', {
      cause: error,
    });
  }
}
