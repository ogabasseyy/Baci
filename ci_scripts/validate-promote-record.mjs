import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function validateRecordTree(entries) {
  if (
    entries.filter((entry) => entry.path === '.gigl-promote-record').length !==
    1
  ) {
    throw new Error('operational tree must contain exactly one record');
  }
  for (const entry of entries) {
    if (entry.mode !== '100644' || entry.content.length > 16384)
      throw new Error('invalid operational record blob');
    if (entry.path === '.gigl-promote-record') {
      if (
        !/^[a-f0-9]{40}:(?:[1-9][0-9]*(?:,[1-9][0-9]*)*)?\n?$/.test(
          entry.content
        )
      ) {
        throw new Error('invalid operational record content');
      }
    } else {
      // Host class mirrors promote_barrier_id(), which sanitizes
      // unsupported hostname characters to '_' — an underscore (or
      // any sanitized character) in the operator hostname must not
      // fail strict validation and block the worker release.
      const barrier =
        /^barriers\/([a-f0-9]{40})-[A-Za-z0-9._-]+-[1-9][0-9]*$/.exec(
          entry.path
        );
      if (!barrier || entry.content.trim() !== barrier[1])
        throw new Error('invalid operational barrier record');
    }
  }
}

function git(args) {
  return execFileSync('git', args, {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
  }).trim();
}

export function validateRecordCommit(commit, previous) {
  if (!/^[a-f0-9]{40}$/.test(commit) || !/^[a-f0-9]{40}$/.test(previous)) {
    throw new Error('invalid operational record commit identity');
  }
  if (!/^0+$/.test(previous)) {
    try {
      git(['cat-file', '-e', `${previous}^{commit}`]);
    } catch {
      throw new Error(
        'Operational remote tip is missing locally; fetch ops/gigl-promote-record before retrying.'
      );
    }
    git(['merge-base', '--is-ancestor', previous, commit]);
  }
  const entries = git(['ls-tree', '-rz', commit])
    .split('\0')
    .filter(Boolean)
    .map((line) => {
      const [metadata, path] = line.split('\t');
      const [mode, type, object] = metadata.split(' ');
      if (type !== 'blob' || !/^[a-f0-9]{40}$/.test(object))
        throw new Error('invalid operational record object');
      const content = execFileSync('git', ['cat-file', 'blob', object], {
        encoding: 'utf8',
        maxBuffer: 16384,
      });
      return { path, mode, content };
    });
  validateRecordTree(entries);
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    validateRecordCommit(process.argv[2], process.argv[3]);
  } catch (error) {
    const message = error.message.startsWith('Operational remote tip')
      ? error.message
      : 'Refusing malformed or non-fast-forward operational record push.';
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}
