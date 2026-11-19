// Decides what to do for this push BEFORE any model call is paid for:
//   bypass          the bypass-ai-gate label is present
//   blocked_private the repository is private and the Gemini key is not confirmed as a paid one
//   no_diff         the pull request diff could not be read, so there is nothing to review
//   duplicate       this exact commit was already reviewed
//   unchanged       a MERGE commit (main merged in) whose pull request changes equal the last review's
//   review          call the model
// A manual `@gemini-cli /review` comment skips the duplicate/unchanged shortcuts (someone asked for
// a fresh answer); the bypass label and the private-repository guard still apply to it.
// Env in: GH_TOKEN, GITHUB_REPOSITORY, PR_NUMBER, HEAD_SHA, FINGERPRINT, PR_LABELS (json),
//   REPO_PRIVATE, PAID_TIER_CONFIRMED, EVENT_NAME, DIFF_AVAILABLE, GITHUB_OUTPUT.
import { isMain, parseJson, setOutputs } from './cli.mjs';
import { githubClient } from './github.mjs';
import { parseMarker } from './review.mjs';

const BOT = 'github-actions[bot]';
const outcome = (action, marker) => ({ action, carryState: marker?.state ?? '', carrySha: marker?.sha ?? '' });

export async function decide({ env, github }) {
  const labels = parseJson(env.PR_LABELS, []);
  if (Array.isArray(labels) && labels.some((label) => label?.name === 'bypass-ai-gate')) return outcome('bypass');
  // Free-tier Gemini content is used to improve Google products: never send private code there.
  if (env.REPO_PRIVATE === 'true' && env.PAID_TIER_CONFIRMED !== 'true') return outcome('blocked_private');
  if (env.DIFF_AVAILABLE === 'false') return outcome('no_diff');
  if (env.EVENT_NAME === 'issue_comment') return outcome('review');

  let reviews;
  try {
    reviews = await github.paginate(`pulls/${env.PR_NUMBER}/reviews`);
  } catch {
    return outcome('review');
  }
  const markers = reviews
    .filter((review) => review.user?.login === BOT)
    .map((review) => {
      const marker = parseMarker(review.body);
      return marker && { ...marker, at: review.submitted_at ?? '' };
    })
    .filter(Boolean)
    .sort((a, b) => a.at.localeCompare(b.at));

  // The same head is only a duplicate when the pull request diff is the same too: a pull request
  // retargeted to another base and reopened keeps its head commit but not its changes.
  const fingerprint = env.FINGERPRINT ?? '';
  const sameCommit = markers.filter((marker) => marker.sha === env.HEAD_SHA && marker.fp === fingerprint).at(-1);
  if (sameCommit) return outcome('duplicate', sameCommit);
  const latest = markers.at(-1);
  // Equal added/removed lines alone do not prove "nothing changed": the same lines moved into
  // another function would match. So only a merge commit may reuse the earlier review; any normal
  // commit is reviewed.
  if (latest && latest.fp && env.FINGERPRINT && latest.fp === env.FINGERPRINT && (await isMergeCommit(github, env))) {
    return outcome('unchanged', latest);
  }
  return outcome('review');
}

async function isMergeCommit(github, env) {
  try {
    const commit = await github.get(`commits/${env.HEAD_SHA}`);
    return Array.isArray(commit?.parents) && commit.parents.length > 1;
  } catch {
    return false;
  }
}

if (isMain(import.meta.url)) {
  const env = process.env;
  const github = githubClient({ token: env.GH_TOKEN, repo: env.GITHUB_REPOSITORY, apiUrl: env.GITHUB_API_URL });
  const result = await decide({ env, github });
  console.log(`::notice::Gemini review decision: ${result.action}${result.carrySha ? ` (carrying ${result.carryState} from ${result.carrySha.slice(0, 7)})` : ''}`);
  setOutputs(env, { action: result.action, carry_state: result.carryState, carry_sha: result.carrySha });
}
