import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const shaPattern = /^[a-f0-9]{40}$/;

// A PR label must never waive checks for other changes in the same merge group.
// Permit the existing exception only if the entire integration tree is exactly
// the merge of latest main and that labeled PR's current head.
export function resolveQueueRevertAllowance({
  repository,
  baseRef,
  headRef,
  baseSha,
  headSha,
  readPullRequest,
  git = (args) =>
    execFileSync('git', args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim(),
}) {
  if (
    !/^[\w.-]+\/[\w.-]+$/.test(repository ?? '') ||
    !shaPattern.test(baseSha ?? '') ||
    !shaPattern.test(headSha ?? '') ||
    !baseRef?.startsWith('refs/heads/')
  )
    return false;
  const branch = baseRef.slice('refs/heads/'.length);
  const prefix = `refs/heads/gh-readonly-queue/${branch}/`;
  if (!headRef?.startsWith(prefix)) return false;
  const match = /^pr-([1-9][0-9]*)(?:-[a-f0-9]{40})?$/.exec(
    headRef.slice(prefix.length),
  );
  if (!match) return false;
  try {
    const pr = readPullRequest(Number(match[1]));
    if (
      pr.state !== 'open' ||
      pr.base?.ref !== branch ||
      pr.base?.repo?.full_name?.toLowerCase() !== repository.toLowerCase() ||
      !shaPattern.test(pr.head?.sha ?? '') ||
      !pr.labels?.some((label) => label.name === 'allow-silent-revert')
    )
      return false;
    // --write-tree computes the merge without touching the worktree/index.
    // A conflict exits nonzero, and missing PR objects also fail closed.
    const expected = git(['merge-tree', '--write-tree', baseSha, pr.head.sha]);
    if (!shaPattern.test(expected)) return false;
    return expected === git(['rev-parse', `${headSha}^{tree}`]);
  } catch {
    return false;
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const repository = process.env.GITHUB_REPOSITORY;
  const allowed = resolveQueueRevertAllowance({
    repository,
    baseRef: process.env.QUEUE_BASE_REF,
    headRef: process.env.QUEUE_HEAD_REF,
    baseSha: process.env.BASE_SHA,
    headSha: process.env.HEAD_SHA,
    readPullRequest: (number) =>
      JSON.parse(
        execFileSync('gh', ['api', `repos/${repository}/pulls/${number}`], {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
        }),
      ),
  });
  appendFileSync(process.env.GITHUB_OUTPUT, `allowed=${allowed}\n`);
}
