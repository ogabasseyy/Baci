import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, lstat, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, parse, relative, resolve } from 'node:path';

import { REQUIRED_UNTRACKED_PREFIXES } from './customer-savings-snapshot-required-prefixes';

const REQUIRED_UNTRACKED_MIGRATIONS = new Set([
  'supabase/migrations/20260917210000_piggyvest_webhook_inbox.sql',
  'supabase/migrations/20260918120000_piggyvest_plan_wallets.sql',
  'supabase/migrations/20260918130000_piggyvest_interest_payouts.sql',
  'supabase/migrations/20260918140000_piggyvest_inflow_credits.sql',
  'supabase/migrations/20260918150000_piggyvest_transfer_outbox.sql',
  'supabase/migrations/20260918160000_piggyvest_customer_read_rls.sql',
  'supabase/migrations/20260918170000_piggyvest_webhook_leases.sql',
  'supabase/migrations/20260918180000_piggyvest_event_quarantine.sql',
  'supabase/migrations/20260918190000_piggyvest_inbox_event_details.sql',
  'supabase/migrations/20260918200000_piggyvest_inbox_details_grant.sql',
  'supabase/migrations/20260918210000_piggyvest_inflow_session_nullable.sql',
]);

const EXCLUDED_DIRECTORY_NAMES = new Set([
  '.cache',
  '.next',
  '.turbo',
  '.vercel',
  'coverage',
  'node_modules',
]);

export type CustomerSavingsDraftSnapshotFile = {
  path: string;
  source: 'tracked' | 'untracked-required';
};

export type CustomerSavingsDraftSourceManifest = {
  files: CustomerSavingsDraftSnapshotFile[];
};

type SourceManifestInput = {
  trackedPaths: readonly string[];
  untrackedPaths: readonly string[];
};

type SnapshotManifestFile = CustomerSavingsDraftSnapshotFile & {
  sha256: string;
};

type SnapshotOptions = {
  destination: string;
  repositoryRoot: string;
};

const SNAPSHOT_COPY_CONCURRENCY = 32;
const GIT_PATH_LIST_MAX_BUFFER_BYTES = 64 * 1024 * 1024;

function isExcluded(path: string): boolean {
  const segments = path.split('/');
  return (
    segments.some((segment) => EXCLUDED_DIRECTORY_NAMES.has(segment)) ||
    segments.some((segment) => segment.startsWith('.playwright')) ||
    basename(path).startsWith('.env')
  );
}

function isRequiredUntracked(path: string): boolean {
  return (
    REQUIRED_UNTRACKED_MIGRATIONS.has(path) ||
    REQUIRED_UNTRACKED_PREFIXES.some((prefix) => path.startsWith(prefix))
  );
}

function sortedUnique(paths: readonly string[]): string[] {
  return [...new Set(paths)].sort((left, right) => left.localeCompare(right));
}

export function createCustomerSavingsDraftSourceManifest(
  input: SourceManifestInput
): CustomerSavingsDraftSourceManifest {
  const tracked = sortedUnique(input.trackedPaths)
    .filter((path) => !isExcluded(path))
    .map((path) => ({ path, source: 'tracked' as const }));
  const untracked = sortedUnique(input.untrackedPaths)
    .filter((path) => !isExcluded(path) && isRequiredUntracked(path))
    .map((path) => ({ path, source: 'untracked-required' as const }));

  return {
    files: [...tracked, ...untracked].sort((left, right) =>
      left.path.localeCompare(right.path)
    ),
  };
}

function gitPaths(repositoryRoot: string, args: string[]): string[] {
  const output = execFileSync('git', args, {
    cwd: repositoryRoot,
    encoding: 'buffer',
    maxBuffer: GIT_PATH_LIST_MAX_BUFFER_BYTES,
  });
  return output.toString('utf8').split('\0').filter(Boolean);
}

function gitRevision(repositoryRoot: string): string {
  return execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  }).trim();
}

function sourcePath(repositoryRoot: string, repositoryPath: string): string {
  const absolutePath = resolve(repositoryRoot, repositoryPath);
  if (relative(repositoryRoot, absolutePath).startsWith('..'))
    throw new Error(`Snapshot path escapes repository: ${repositoryPath}`);
  return absolutePath;
}

export function assertCustomerSavingsDraftSnapshotDestination(
  repositoryRoot: string,
  destination: string
): void {
  const resolvedRepositoryRoot = resolve(repositoryRoot);
  const resolvedDestination = resolve(destination);
  if (resolvedDestination === parse(resolvedDestination).root)
    throw new Error('Snapshot destination must not be the filesystem root');
  if (
    resolvedDestination === resolvedRepositoryRoot ||
    !relative(resolvedRepositoryRoot, resolvedDestination).startsWith('..') ||
    !relative(resolvedDestination, resolvedRepositoryRoot).startsWith('..')
  )
    throw new Error('Snapshot destination must be outside the repository');
}

async function copySnapshotFile(
  repositoryRoot: string,
  destination: string,
  file: CustomerSavingsDraftSnapshotFile
): Promise<SnapshotManifestFile> {
  const source = sourcePath(repositoryRoot, file.path);
  const fileStats = await lstat(source);
  if (!fileStats.isFile() || fileStats.isSymbolicLink())
    throw new Error(`Snapshot source must be a regular file: ${file.path}`);

  const contents = await readFile(source);
  const target = sourcePath(destination, file.path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, contents, { mode: fileStats.mode });
  return {
    ...file,
    sha256: createHash('sha256').update(contents).digest('hex'),
  };
}

export async function createCustomerSavingsDraftSourceSnapshot(
  options: SnapshotOptions
): Promise<{ manifestPath: string; revision: string }> {
  const repositoryRoot = resolve(options.repositoryRoot);
  const destination = resolve(options.destination);
  assertCustomerSavingsDraftSnapshotDestination(repositoryRoot, destination);
  try {
    await mkdir(destination);
  } catch (error: unknown) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'EEXIST'
    )
      throw new Error('Snapshot destination already exists');
    throw error;
  }
  const manifest = createCustomerSavingsDraftSourceManifest({
    trackedPaths: gitPaths(repositoryRoot, ['ls-files', '-z']),
    untrackedPaths: gitPaths(repositoryRoot, [
      'ls-files',
      '--others',
      '--exclude-standard',
      '-z',
    ]),
  });
  const revision = gitRevision(repositoryRoot);
  const files: SnapshotManifestFile[] = [];
  for (
    let start = 0;
    start < manifest.files.length;
    start += SNAPSHOT_COPY_CONCURRENCY
  ) {
    const batch = manifest.files.slice(
      start,
      start + SNAPSHOT_COPY_CONCURRENCY
    );
    files.push(
      ...(await Promise.all(
        batch.map((file) => copySnapshotFile(repositoryRoot, destination, file))
      ))
    );
  }
  const manifestPath = join(
    destination,
    'customer-savings-draft-source-manifest.json'
  );
  await writeFile(
    manifestPath,
    `${JSON.stringify({ format: 1, revision, files }, null, 2)}\n`
  );
  return { manifestPath, revision };
}

async function requireDirectory(path: string): Promise<void> {
  try {
    if (!(await stat(path)).isDirectory()) throw new Error();
  } catch {
    throw new Error(`Standalone output missing directory: ${path}`);
  }
}

export async function verifyCustomerSavingsDraftStandaloneOutput(
  standaloneRoot: string
): Promise<{ applicationRoot: string; serverPath: string }> {
  const applicationRoot = join(standaloneRoot, 'apps/web');
  const serverPath = join(applicationRoot, 'server.js');
  try {
    if (!(await stat(serverPath)).isFile()) throw new Error();
  } catch {
    throw new Error(`Standalone output missing monorepo server: ${serverPath}`);
  }
  await requireDirectory(join(applicationRoot, 'public'));
  await requireDirectory(join(applicationRoot, '.next/static'));
  return { applicationRoot, serverPath };
}

export async function prepareCustomerSavingsDraftStandaloneAssets(
  nextOutputRoot: string
): Promise<{ applicationRoot: string; serverPath: string }> {
  const standaloneRoot = join(nextOutputRoot, 'standalone');
  const applicationRoot = join(standaloneRoot, 'apps/web');
  const serverPath = join(applicationRoot, 'server.js');
  try {
    if (!(await stat(serverPath)).isFile()) throw new Error();
  } catch {
    throw new Error(`Standalone output missing monorepo server: ${serverPath}`);
  }
  await cp(
    join(dirname(nextOutputRoot), 'public'),
    join(applicationRoot, 'public'),
    {
      recursive: true,
    }
  );
  await cp(
    join(nextOutputRoot, 'static'),
    join(applicationRoot, '.next/static'),
    {
      recursive: true,
    }
  );
  return verifyCustomerSavingsDraftStandaloneOutput(standaloneRoot);
}
