// Reads the live state of one pull request from GitHub and returns the stage
// decision. Shared by the `changes` job (resolve-stage.mjs) and the nudge
// workflow (nudge.mjs) so the two can never disagree about the rules.
import { collectEvidence } from './codex-evidence.mjs';
import { evaluateVerdict } from './codex-verdict.mjs';
import { buildCarryOver } from './net-diff.mjs';
import { decideStage } from './stage-decision.mjs';

// Decisions that do not depend on what Codex said: no need to read comments.
const DECIDED_WITHOUT_CODEX = new Set(['not-pull-request', 'fork', 'mode-off', 'pilot-not-selected', 'closed', 'superseded', 'break-glass']);
// Decisions that need no API call at all (legacy paths stay untouched and offline).
const DECIDED_OFFLINE = new Set(['not-pull-request', 'fork', 'mode-off']);

export async function evaluatePullRequestStage({ client, repository, prNumber, headSha, eventName, mode, ageMinutes, timeoutMinutes, sameRepo = true }) {
  const facts = { eventName, mode, sameRepo, headSha, ageMinutes, timeoutMinutes };

  const offline = decideStage({ ...facts, verdict: { state: 'none', reason: '' }, ageMinutes: 0 });
  if (DECIDED_OFFLINE.has(offline.code)) return { decision: offline, verdict: null };

  let pr;
  try {
    pr = await client.get(`/repos/${repository}/pulls/${prNumber}`);
  } catch (error) {
    return { decision: decideStage({ ...facts, apiError: error.message }), verdict: null };
  }

  const live = {
    ...facts,
    labels: (pr.labels ?? []).map((label) => label.name),
    draft: Boolean(pr.draft),
    open: pr.state === 'open',
    liveHeadSha: pr.head?.sha,
  };
  const early = decideStage({ ...live, verdict: { state: 'none', reason: '' }, ageMinutes: 0 });
  if (DECIDED_WITHOUT_CODEX.has(early.code)) return { decision: early, verdict: null, pr };

  try {
    const [issueComments, reviews, reviewComments] = await Promise.all([
      client.paginate(`/repos/${repository}/issues/${prNumber}/comments`),
      client.paginate(`/repos/${repository}/pulls/${prNumber}/reviews`),
      client.paginate(`/repos/${repository}/pulls/${prNumber}/comments`),
    ]);
    const { evidence, unrecognized } = collectEvidence({ issueComments, reviews, reviewComments });
    const verdict = await evaluateVerdict({
      evidence,
      headSha,
      resolveSha: async (abbreviation) => (await client.get(`/repos/${repository}/commits/${abbreviation}`)).sha,
      carryOver: buildCarryOver({ client, repository, base: pr.base?.ref ?? 'main' }),
    });
    verdict.unrecognized = unrecognized;
    return { decision: decideStage({ ...live, verdict }), verdict, pr };
  } catch (error) {
    return { decision: decideStage({ ...live, verdict: null, apiError: error.message }), verdict: null, pr };
  }
}
