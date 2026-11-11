// Proof that two commits carry the same pull-request change.
//
// For each commit, GitHub's three-dot compare against the base branch lists the
// files the pull request touches. Two commits carry the same change only if every
// touched file has the same status, rename source, final blob sha AND the same
// hunks (the "-" and context lines are the base side of the change). The hunks matter:
// when a sync changes main's side of a touched file but the conflict resolution keeps
// the PR's version, the final blob is unchanged although the reviewed change A->C
// became B->C. Hunk line numbers are ignored (a sync can shift them), their content is
// not. A file whose patch is unavailable (binary or oversized), an unreadable
// comparison or a truncated list (300 files) cannot be proven.

const COMPARE_FILE_CAP = 300;
const HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@.*$/gm;

function fileSignature(file) {
  const noContentChange = (file.changes ?? 0) === 0 && file.status === 'renamed';
  if (typeof file.patch !== 'string' && !noContentChange && file.status !== 'removed') return null;
  const patch = typeof file.patch === 'string' ? file.patch.replace(HUNK_HEADER, '@@') : '';
  return [file.status, file.filename, file.previous_filename ?? '', file.sha ?? '', patch].join('\t');
}

export function sameNetDiff(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right)) return false;
  if (left.length === 0 || right.length === 0) return false;
  if (left.length >= COMPARE_FILE_CAP || right.length >= COMPARE_FILE_CAP) return false;
  const leftSignatures = left.map(fileSignature);
  const rightSignatures = right.map(fileSignature);
  if (leftSignatures.includes(null) || rightSignatures.includes(null)) return false;
  return leftSignatures.sort().join('\n') === rightSignatures.sort().join('\n');
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
