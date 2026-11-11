// Proof that two commits carry the same pull-request change.
//
// For each commit, GitHub's three-dot compare against the base branch lists the
// files the pull request touches, with the blob sha of each file at that commit.
// Two commits carry the same change only if every touched file has the same
// status, rename source and blob sha. A sync merge from the base branch that does
// not touch the pull request's files passes; a changed file, a conflict
// resolution, an unreadable comparison or a truncated list (300 files) does not.

const COMPARE_FILE_CAP = 300;

function signature(files) {
  return files
    .map((file) => [file.status, file.filename, file.previous_filename ?? '', file.sha ?? ''].join('\t'))
    .sort()
    .join('\n');
}

export function sameNetDiff(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right)) return false;
  if (left.length === 0 || right.length === 0) return false;
  if (left.length >= COMPARE_FILE_CAP || right.length >= COMPARE_FILE_CAP) return false;
  return signature(left) === signature(right);
}

export function buildCarryOver({ client, repository, base }) {
  const load = async (sha) => {
    const comparison = await client.get(`/repos/${repository}/compare/${base}...${sha}?per_page=100`);
    return comparison?.files ?? [];
  };
  return async (from, to) => {
    const [left, right] = await Promise.all([load(from), load(to)]);
    return sameNetDiff(left, right);
  };
}
