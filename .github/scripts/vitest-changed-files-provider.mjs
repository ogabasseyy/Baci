// Vitest `experimental.vcsProvider` for `vitest --changed`.
//
// `vitest --changed` selects tests whose import graph contains a changed file.
// It cannot see data files that tests read through fs (SQL migrations, docs,
// workflow files, ...), so a pull request that only touches those used to need
// the whole suite. This provider returns the same changed files as Vitest's
// built-in git provider and, for changed files in an fs-reader family (see
// `resolve-ci-test-plan-paths.mjs`), also returns every source file that both
// uses fs and mentions the changed path. Vitest then runs those files if they
// are tests and the tests that import them if they are helpers.
//
// It over-approximates on purpose (a comment that names a path is enough):
// an extra test is cheap, a missed one is not. Nothing is scanned when the
// diff holds no fs-reader file, so ordinary code changes behave as before.
//
// Wired in apps/web/vitest.config.ts as `test.experimental.vcsProvider`.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { readerNeedlesFor } from './resolve-ci-test-plan-paths.mjs';

const SOURCE_FILE_GLOBS = [
  '*.ts',
  '*.tsx',
  '*.mts',
  '*.cts',
  '*.js',
  '*.jsx',
  '*.mjs',
  '*.cjs',
];
const MAX_SOURCE_BYTES = 1_500_000;

// Tests often hand a path to a helper that does the reading, so a test or test
// support file counts as a reader as soon as it mentions the path. Any other
// module must also use fs, which skips the many modules that only name a path
// in a comment or an error message.
const TEST_FILE =
  /(?:\.(?:test|spec)\b|[.-](?:support|fixtures?|helpers?|utils)\b|(?:^|\/)(?:__tests__|__mocks__|tests?|test-utils|test-support)\/)/;
const FILE_ACCESS =
  /(?:node:)?fs(?:\/promises)?['"]|child_process|import\.meta\.glob|\b(?:readFileSync|readdirSync|existsSync|statSync|readFile|readdir)\b/;

function git(args, cwd) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
}

const lines = (output) => output.split('\n').filter(Boolean);

// Same sources as Vitest's built-in git provider (commits since the base,
// staged, then unstaged or untracked), except that renames are listed as a
// deletion plus an addition so the old path is not lost.
export function listGitChangedFiles({ root, changedSince }) {
  const top = git(['rev-parse', '--show-toplevel'], root).trim();
  const committed =
    typeof changedSince === 'string'
      ? lines(
          git(
            ['diff', '--name-only', '--no-renames', `${changedSince}...HEAD`],
            top
          )
        )
      : [];
  const staged = lines(
    git(['diff', '--cached', '--name-only', '--no-renames'], top)
  );
  const unstaged = lines(
    git(['ls-files', '--other', '--modified', '--exclude-standard'], top)
  );

  return { top, files: [...new Set([...committed, ...staged, ...unstaged])] };
}

export function listCandidateSources(top) {
  return lines(
    git(
      [
        'ls-files',
        '--cached',
        '--others',
        '--exclude-standard',
        '--',
        ...SOURCE_FILE_GLOBS,
      ],
      top
    )
  );
}

function readSource(path) {
  try {
    const text = readFileSync(path, 'utf8');
    return text.length > MAX_SOURCE_BYTES ? undefined : text;
  } catch {
    return undefined;
  }
}

// `join('a', 'b')` and `'a/b'` must look the same, and so must Windows slashes.
export function normalizeForNeedles(text) {
  return text.replace(/\\/g, '/').replace(/['"`]\s*,\s*['"`]/g, '/');
}

export function findFsReaders({ changedFiles, listCandidates, readText }) {
  const needles = [...new Set(changedFiles.flatMap(readerNeedlesFor))];
  if (needles.length === 0) {
    return [];
  }

  const readers = [];
  for (const candidate of listCandidates()) {
    const text = readText(candidate);
    if (
      text === undefined ||
      (!TEST_FILE.test(candidate) && !FILE_ACCESS.test(text))
    ) {
      continue;
    }
    const normalized = normalizeForNeedles(text);
    if (needles.some((needle) => normalized.includes(needle))) {
      readers.push(candidate);
    }
  }

  return readers;
}

export function findChangedFilesWithFsReaders({ root, changedSince }) {
  const { top, files } = listGitChangedFiles({ root, changedSince });
  const readers = findFsReaders({
    changedFiles: files,
    listCandidates: () => listCandidateSources(top),
    readText: (file) => readSource(resolve(top, file)),
  });
  const added = readers.filter((file) => !files.includes(file));
  if (added.length > 0) {
    console.error(
      `changed-files provider: added ${added.length} source file(s) that read the changed paths`
    );
  }

  return [...new Set([...files, ...readers])].map((file) => resolve(top, file));
}

// Vitest's contract is `findChangedFiles(options): Promise<string[]>`.
export default {
  findChangedFiles(options) {
    return Promise.resolve().then(() => findChangedFilesWithFsReaders(options));
  },
};
