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
// What it cannot find: a test that builds the path without writing it as a
// literal, a non-test module that neither uses fs, builds paths nor holds the
// path as a literal, and readers written in shell, Python or SQL (those are not
// Vitest tests; their own CI jobs run them). Test files too large to search are
// assumed to be readers. Other modules too large to search are skipped, because
// the realistic case is a generated types file (it reads nothing, and treating it
// as a reader would select every test that imports it); they are named in the log.
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
// `readText` returns this for a file too large to search.
export const TOO_LARGE = null;

// Tests often hand a path to a helper that does the reading, so a test or test
// support file counts as a reader as soon as it mentions the path. Any other
// module must also use fs, build paths, or hold the path as a literal of its own
// (a helper that only exports `'supabase/migrations'` or
// `join(ROOT, 'supabase', 'migrations')` is read through by its importers).
// That skips the many modules that only name a path in a comment or an error
// message.
const TEST_FILE =
  /(?:\.(?:test|spec)\b|[.-](?:support|fixtures?|helpers?|utils)\b|(?:^|\/)(?:__tests__|__mocks__|tests?|test-utils|test-support)\/)/;
const FILE_ACCESS =
  /(?:node:)?fs(?:\/promises)?['"]|fs-extra|graceful-fs|fast-glob|globby|tinyglobby|child_process|import\.meta\.glob|\b(?:readFileSync|readdirSync|existsSync|statSync|lstatSync|accessSync|globSync)\b|\b(?:readFile|readdir|opendir|createReadStream|stat|lstat|access|realpath|glob)\s*\(|(?:node:)?path['"]|__dirname|import\.meta\.(?:url|dirname)|process\.cwd\(\)/;

/**
 * A git failure must stop the run: returning an empty list would tell Vitest
 * that nothing changed and select no tests at all.
 */
function git(args, cwd) {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    const detail = String(error.stderr ?? error.message).trim();
    throw new Error(
      `changed-files provider: git ${args.join(' ')} failed: ${detail}`
    );
  }
}

const lines = (output) => output.split('\n').filter(Boolean);

/**
 * Same sources as Vitest's built-in git provider (commits since the base,
 * staged, then unstaged or untracked), except that renames are listed as a
 * deletion plus an addition so the old path is not lost.
 */
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

/** Tracked and untracked source files that may read a data file. */
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

/** The file's text, `TOO_LARGE` over the size cap, or `undefined` when unreadable. */
function readSource(path) {
  try {
    const text = readFileSync(path, 'utf8');
    return text.length > MAX_SOURCE_BYTES ? TOO_LARGE : text;
  } catch {
    return undefined;
  }
}

/**
 * `join('a', 'b')`, `'a/b'`, Windows slashes and a regex-escaped `a\/b` must all
 * look the same.
 */
export function normalizeForNeedles(text) {
  return text
    .replace(/\\/g, '/')
    .replace(/\/{2,}/g, '/')
    .replace(/['"`]\s*,\s*['"`]/g, '/');
}

const QUOTES = new Set(["'", '"', '`']);
const MAX_LITERAL_LENGTH = 300;

/**
 * Walks from `from` in `step` direction to the nearest quote; whitespace first
 * means the text around it is a sentence, not a path.
 */
function reachesQuote(text, from, step) {
  const stop = from + step * MAX_LITERAL_LENGTH;
  for (let i = from; i !== stop && i >= 0 && i < text.length; i += step) {
    if (QUOTES.has(text[i])) {
      return true;
    }
    if (/\s/.test(text[i])) {
      return false;
    }
  }
  return false;
}

/**
 * A path needle is a path constant when it sits in a quoted literal that holds
 * nothing but a path (`'../../supabase/migrations'`), unlike a message such as
 * `'apply supabase/migrations first'`. Bare words (`'docs'`) never qualify.
 */
function namesPathLiteral(text, needle) {
  if (!/[/.]/.test(needle.replace(/^['"`]|['"`]$/g, ''))) {
    return false;
  }
  const opensLiteral = QUOTES.has(needle[0]);
  const closesLiteral = QUOTES.has(needle[needle.length - 1]);
  for (
    let at = text.indexOf(needle);
    at !== -1;
    at = text.indexOf(needle, at + 1)
  ) {
    if (
      (opensLiteral || reachesQuote(text, at - 1, -1)) &&
      (closesLiteral || reachesQuote(text, at + needle.length, 1))
    ) {
      return true;
    }
  }
  return false;
}

/** Source files that read, or hold the path of, any of the changed data files. */
export function findFsReaders({ changedFiles, listCandidates, readText }) {
  const needles = [...new Set(changedFiles.flatMap(readerNeedlesFor))];
  if (needles.length === 0) {
    return [];
  }

  const readers = [];
  for (const candidate of listCandidates()) {
    const text = readText(candidate);
    if (text === undefined) {
      continue;
    }
    if (text === TOO_LARGE) {
      // Cannot be searched: a test might read the file, so assume it does.
      if (TEST_FILE.test(candidate)) {
        readers.push(candidate);
      }
      continue;
    }
    const normalized = normalizeForNeedles(text);
    const named = needles.filter((needle) => normalized.includes(needle));
    if (
      named.length > 0 &&
      (TEST_FILE.test(candidate) ||
        FILE_ACCESS.test(text) ||
        named.some((needle) => namesPathLiteral(normalized, needle)))
    ) {
      readers.push(candidate);
    }
  }

  return readers;
}

/** The changed files plus the readers of the changed data files, as absolute paths. */
export function findChangedFilesWithFsReaders({ root, changedSince }) {
  const { top, files } = listGitChangedFiles({ root, changedSince });
  const unsearched = [];
  const readers = findFsReaders({
    changedFiles: files,
    listCandidates: () => listCandidateSources(top),
    readText: (file) => {
      const text = readSource(resolve(top, file));
      if (text === TOO_LARGE && !TEST_FILE.test(file)) {
        unsearched.push(file);
      }
      return text;
    },
  });
  if (unsearched.length > 0) {
    console.error(
      `changed-files provider: ${unsearched.length} module(s) over ${MAX_SOURCE_BYTES} bytes were not searched (for example ${unsearched.slice(0, 3).join(', ')})`
    );
  }
  const added = readers.filter((file) => !files.includes(file));
  if (added.length > 0) {
    const sample = added.slice(0, 3).join(', ');
    console.error(
      `changed-files provider: added ${added.length} source file(s) that read the changed paths (for example ${sample})`
    );
  }

  return [...new Set([...files, ...readers])].map((file) => resolve(top, file));
}

/**
 * Vitest's contract is `findChangedFiles(options): Promise<string[]>`.
 */
export default {
  findChangedFiles(options) {
    return Promise.resolve().then(() => findChangedFilesWithFsReaders(options));
  },
};
