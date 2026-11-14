// Git inputs for the CI test planner: the changed files of a pull request, and
// the subset of them that no longer exists in the head.
import { execFileSync } from 'node:child_process';

/**
 * Arguments of the `git diff` that lists the files a pull request changes.
 *
 * Deleted files and both sides of a rename are real changes: a PR that deletes
 * a shared file, or moves it out of a package, can break tests that still
 * import it. `--no-renames` lists the old path of a rename as a deletion, and
 * the absence of a `--diff-filter` keeps deletions in the list. Extra options
 * go before the revision range, the usual `git diff [<options>] <range>` order.
 *
 * @param {string} baseRef
 * @param {string} headRef
 * @param {string[]} [options] extra `git diff` options, such as `--diff-filter=D`
 * @returns {string[]}
 */
export function changedFilesDiffArgs(baseRef, headRef, options = []) {
  return [
    'diff',
    '--name-only',
    '--no-renames',
    ...options,
    `${baseRef}...${headRef}`,
  ];
}

/**
 * Runs the diff and returns one path per line, or `onFailure` when git fails.
 *
 * @param {string} baseRef
 * @param {string} headRef
 * @param {string[]} options
 * @param {string | undefined} cwd
 * @param {null | string[]} onFailure
 * @returns {string[] | null}
 */
function listDiffFiles(baseRef, headRef, options, cwd, onFailure) {
  try {
    return execFileSync(
      'git',
      changedFilesDiffArgs(baseRef, headRef, options),
      { cwd, encoding: 'utf8' }
    )
      .split('\n')
      .filter(Boolean);
  } catch {
    return onFailure;
  }
}

/**
 * Every file the head changes against the base, deletions and rename sources
 * included. A git failure returns no files, which the planner reads as an empty
 * diff and answers with the full suite.
 *
 * @param {string} baseRef
 * @param {string} headRef
 * @param {{ cwd?: string }} [location]
 * @returns {string[]}
 */
export function getChangedFiles(baseRef, headRef, { cwd } = {}) {
  return listDiffFiles(baseRef, headRef, [], cwd, []);
}

/**
 * The subset of `getChangedFiles` that no longer exists in the head: deleted
 * files and the old side of a rename (`--no-renames` turns a rename into a
 * deletion plus an addition). `null` when git fails: "no deletions" would switch
 * the deletion guard off, so the planner keeps the full suite instead.
 *
 * @param {string} baseRef
 * @param {string} headRef
 * @param {{ cwd?: string }} [location]
 * @returns {string[] | null}
 */
export function getDeletedFiles(baseRef, headRef, { cwd } = {}) {
  return listDiffFiles(baseRef, headRef, ['--diff-filter=D'], cwd, null);
}
