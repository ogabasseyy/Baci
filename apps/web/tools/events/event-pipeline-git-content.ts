import { execFileSync } from 'node:child_process';

export function readGitIndexSources(
  root: string,
  paths: readonly string[]
): Map<string, string> {
  const sources = new Map<string, string>();
  if (paths.length === 0) return sources;

  const records = execFileSync(
    'git',
    ['--literal-pathspecs', 'ls-files', '--stage', '-z', '--', ...paths],
    { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
  )
    .split('\0')
    .filter(Boolean);

  for (const record of records) {
    const separator = record.indexOf('\t');
    if (separator < 0) {
      throw new Error('Malformed git index record');
    }
    const [, objectId, stage] = record.slice(0, separator).split(/\s+/);
    if (!objectId || stage !== '0') continue;

    const path = record.slice(separator + 1);
    const source = execFileSync('git', ['cat-file', 'blob', objectId], {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
    sources.set(path, source);
  }

  return sources;
}
