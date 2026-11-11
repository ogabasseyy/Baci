// Git inputs for the CI test planner: the changed files of a pull request, and
// the subset of them that no longer exists in the head.
import { execFileSync } from 'node:child_process';

// Deleted files and both sides of a rename are real changes: a PR that deletes
// a shared file, or moves it out of a package, can break tests that still
// import it. `--no-renames` lists the old path of a rename as a deletion, and
// the absence of a `--diff-filter` keeps deletions in the list.
export function changedFilesDiffArgs(baseRef, headRef) {
  return ['diff', '--name-only', '--no-renames', `${baseRef}...${headRef}`];
}

export function getChangedFiles(baseRef, headRef, { cwd } = {}) {
  try {
    return execFileSync('git', changedFilesDiffArgs(baseRef, headRef), {
      cwd,
      encoding: 'utf8',
    })
      .split('\n')
      .filter(Boolean);
  } catch {
    return [];
  }
}

// The subset of `getChangedFiles` that no longer exists in the head: deleted
// files and the old side of a rename (`--no-renames` turns a rename into a
// deletion plus an addition).
export function getDeletedFiles(baseRef, headRef, { cwd } = {}) {
  try {
    return execFileSync(
      'git',
      [...changedFilesDiffArgs(baseRef, headRef), '--diff-filter=D'],
      { cwd, encoding: 'utf8' }
    )
      .split('\n')
      .filter(Boolean);
  } catch {
    return [];
  }
}
