import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  readGitBlobSources,
  readGitIndexSources,
} from './event-pipeline-git-content';
import { eventPipelineSourceFilePolicy } from './event-pipeline-source-file-policy';

function gitPaths(root: string, args: readonly string[]): string[] {
  return execFileSync(
    'git',
    [...args, '--', ...eventPipelineSourceFilePolicy.pathspecs],
    {
      cwd: root,
      encoding: 'utf8',
      // `git ls-files` output for this repo exceeds Node's 1 MiB default
      // execFileSync buffer (spawnSync git ENOBUFS on CI); match the
      // explicit buffers used elsewhere in this module.
      maxBuffer: 64 * 1024 * 1024,
    }
  )
    .split('\0')
    .filter(Boolean);
}

function readCommittedRevisionSources(
  root: string,
  revision: string
): Map<string, string> {
  const tree = execFileSync(
    'git',
    ['ls-tree', '-r', '-z', '--full-tree', revision],
    {
      cwd: root,
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    }
  );
  const entries = tree
    .toString('utf8')
    .split('\0')
    .filter(Boolean)
    .map((record) => {
      const separator = record.indexOf('\t');
      const header = record.slice(0, separator).split(' ');
      const object = header[2];
      const path = record.slice(separator + 1);
      if (separator < 0 || header[1] !== 'blob' || !object || !path) {
        throw new Error('invalid_frozen_source_tree');
      }
      return { object, path };
    })
    .filter(({ path }) => eventPipelineSourceFilePolicy.isSourcePath(path));
  if (entries.length === 0) return new Map();
  return readGitBlobSources(root, entries);
}

function discoverCurrentGitSources(root: string) {
  const tracked = gitPaths(root, ['ls-files', '--cached', '-z']);
  const untracked = gitPaths(root, [
    'ls-files',
    '--others',
    '--exclude-standard',
    '-z',
  ]);
  const staged = new Set(
    gitPaths(root, [
      'diff',
      '--cached',
      '--no-renames',
      '--name-only',
      '--diff-filter=ACMRTUXB',
      '-z',
    ])
  );
  const deleted = new Set(
    gitPaths(root, [
      'diff',
      '--cached',
      '--no-renames',
      '--name-only',
      '--diff-filter=D',
      '-z',
    ])
  );
  const allPaths = [...new Set([...tracked, ...untracked])];
  const paths = allPaths.filter((path) => !deleted.has(path)).sort();
  return { allPaths, paths, staged };
}

function readImportClosureSources(
  root: string
): Pick<ReadonlyMap<string, string>, 'get' | 'has'> {
  const { paths, staged } = discoverCurrentGitSources(root);
  const known = new Set(paths);
  const index = readGitIndexSources(root, [...staged]);
  const cache = new Map<string, string | undefined>();
  function get(path: string): string | undefined {
    if (!known.has(path)) return undefined;
    if (cache.has(path)) return cache.get(path);
    const absolute = resolve(root, path);
    const source = staged.has(path)
      ? index.get(path)
      : existsSync(absolute)
        ? readFileSync(absolute, 'utf8')
        : undefined;
    cache.set(path, source);
    return source;
  }
  return { get, has: (path) => get(path) !== undefined };
}

function readCurrentGitSourceSnapshot(root: string): {
  filesystemSources: Map<string, string>;
  indexSources: Map<string, string>;
  missingPaths: string[];
  missingStagedPaths: string[];
  sources: Map<string, string>;
} {
  const { allPaths, paths, staged } = discoverCurrentGitSources(root);
  const missingPaths: string[] = [];
  const missingStagedPaths: string[] = [];
  const sources = new Map<string, string>();
  const stagedSources = readGitIndexSources(root, [...staged]);
  const filesystemSources = new Map<string, string>();
  for (const path of allPaths) {
    const absolute = resolve(root, path);
    if (existsSync(absolute))
      filesystemSources.set(path, readFileSync(absolute, 'utf8'));
  }

  for (const path of paths) {
    if (staged.has(path)) {
      const source = stagedSources.get(path);
      if (source === undefined) {
        missingPaths.push(path);
        missingStagedPaths.push(path);
        continue;
      }
      sources.set(path, source);
      continue;
    }
    const source = filesystemSources.get(path);
    if (source === undefined) {
      missingPaths.push(path);
      continue;
    }
    sources.set(path, source);
  }

  return {
    filesystemSources,
    indexSources: sources,
    missingPaths,
    missingStagedPaths,
    sources,
  };
}

export const readGitSourceSnapshot = Object.assign(
  readCurrentGitSourceSnapshot,
  {
    committedRevision: readCommittedRevisionSources,
    forImportClosure: readImportClosureSources,
  }
);
