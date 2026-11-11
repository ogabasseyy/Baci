import { execFileSync } from 'node:child_process';

interface GitBlobSource {
  object: string;
  path: string;
}
/** Bounded binary framing preserves duplicate objects and arbitrary Git paths. */
export function readGitBlobSources(
  root: string,
  entries: readonly GitBlobSource[]
): Map<string, string> {
  if (!entries.length) return new Map();
  if (
    entries.some(
      ({ object }) => !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(object)
    )
  )
    throw Error('invalid_git_source_object');
  const batch = execFileSync('git', ['cat-file', '--batch'], {
    cwd: root,
    input: `${entries.map(({ object }) => object).join('\n')}\n`,
    maxBuffer: 256 * 1024 * 1024,
  });
  const sources = new Map<string, string>();
  let offset = 0;
  for (const { object, path } of entries) {
    const headerEnd = batch.indexOf(10, offset);
    if (headerEnd < 0) throw Error('invalid_git_source_batch');
    const header = batch.subarray(offset, headerEnd).toString('utf8');
    const match = /^([a-f0-9]{40}|[a-f0-9]{64}) blob (0|[1-9][0-9]*)$/.exec(
      header
    );
    const size = Number(match?.[2]);
    const start = headerEnd + 1;
    const end = start + size;
    if (
      !match ||
      match[1] !== object ||
      !Number.isSafeInteger(size) ||
      size < 0 ||
      end >= batch.length ||
      batch[end] !== 10
    )
      throw Error('invalid_git_source_batch');
    sources.set(path, batch.subarray(start, end).toString('utf8'));
    offset = end + 1;
  }
  if (offset !== batch.length) throw Error('invalid_git_source_batch');
  return sources;
}
export function readGitIndexSources(
  root: string,
  paths: readonly string[]
): Map<string, string> {
  if (!paths.length) return new Map();
  const records = execFileSync(
    'git',
    ['--literal-pathspecs', 'ls-files', '--stage', '-z', '--', ...paths],
    { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
  )
    .split('\0')
    .filter(Boolean);
  const entries: GitBlobSource[] = [];
  for (const record of records) {
    const separator = record.indexOf('\t');
    if (separator < 0) throw Error('Malformed git index record');
    const [, object, stage] = record.slice(0, separator).split(/\s+/);
    if (!object || stage !== '0') continue;
    entries.push({ object, path: record.slice(separator + 1) });
  }
  return readGitBlobSources(root, entries);
}
