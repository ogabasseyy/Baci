// Tests outside apps/web that read a changed data file.
//
// The Vitest provider (vitest-changed-files-provider.mjs) only reaches tests in
// apps/web. The tests of the mobile apps and of the packages run only on the full
// affected path, so a pull request whose changed data file is named by one of
// them has to keep that path. Only the file itself counts (its path, or its bare
// name next to a quote or separator): those tests also mention folders such as
// `.github/workflows` while reading other files, and no test outside apps/web
// lists such a folder today (a contract test watches for the first one).
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import {
  exactReaderNeedlesFor,
  isFsReaderFile,
} from './resolve-ci-test-plan-paths.mjs';
import {
  listCandidateSources,
  normalizeForNeedles,
  readSource,
  TOO_LARGE,
} from './vitest-changed-files-provider.mjs';

/** Workspaces whose tests only the full affected path runs. */
export const NON_WEB_WORKSPACE =
  /^(?:apps\/mobile-admin|apps\/mobile-storefront|packages\/[^/]+)\//;

/**
 * Source files of the other workspaces that name any changed data file.
 *
 * @param {object} input
 * @param {string[]} input.changedFiles every file the change touches
 * @param {() => string[]} input.listCandidates tracked source files
 * @param {(file: string) => string | null | undefined} input.readText a file's
 *   text, `TOO_LARGE` when it cannot be searched, `undefined` when unreadable
 * @returns {string[]}
 */
export function findNonWebReaderFiles({
  changedFiles,
  listCandidates,
  readText,
}) {
  const needles = [
    ...new Set(
      changedFiles.filter(isFsReaderFile).flatMap(exactReaderNeedlesFor)
    ),
  ];
  if (needles.length === 0) {
    return [];
  }

  return listCandidates().filter((file) => {
    if (!NON_WEB_WORKSPACE.test(file)) {
      return false;
    }
    const text = readText(file);
    if (text === undefined) {
      return false;
    }
    if (text === TOO_LARGE) {
      // Cannot be searched: it might name the data file, so assume it does.
      return true;
    }
    const normalized = normalizeForNeedles(text);
    return needles.some((needle) => normalized.includes(needle));
  });
}

/**
 * Searches the checkout that `cwd` belongs to. It throws when git fails, and the
 * caller must then keep the full path.
 *
 * @param {string[]} changedFiles
 * @param {{ cwd?: string }} [location]
 * @returns {string[]}
 */
export function findNonWebReaders(changedFiles, { cwd } = {}) {
  const top = execFileSync('git', ['rev-parse', '--show-toplevel'], {
    cwd,
    encoding: 'utf8',
  }).trim();

  return findNonWebReaderFiles({
    changedFiles,
    listCandidates: () => listCandidateSources(top),
    readText: (file) => readSource(resolve(top, file)),
  });
}
