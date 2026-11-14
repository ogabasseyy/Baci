// Reads the live state of one pull request from GitHub and returns the stage
// decision. Shared by the `changes` job (resolve-stage.mjs) and the nudge
// workflow (nudge.mjs) so the two can never disagree about the rules.
import { collectEvidence } from './codex-evidence.mjs';
import { evaluateVerdict } from './codex-verdict.mjs';
import { buildCarryOver } from './net-diff.mjs';
import { decideStage } from './stage-decision.mjs';

// Decisions that do not depend on what Codex said: no need to read comments.
const DECIDED_WITHOUT_CODEX = new Set(['not-pull-request', 'fork', 'mode-off', 'pilot-not-selected', 'closed', 'superseded', 'draft', 'break-glass']);
// Decisions that need no API call at all (legacy paths stay untouched and offline).
const DECIDED_OFFLINE = new Set(['not-pull-request', 'fork', 'mode-off']);

// When the pull request last went from draft to ready. A draft can sit for hours without a
// Codex review; the no-verdict timeout must count from the moment it is ready, not from the push.
async function lastReadyForReview(client, repository, prNumber) {
  const events = await client.paginate(`/repos/${repository}/issues/${prNumber}/events`);
  const times = events.filter((event) => event.event === 'ready_for_review').map((event) => Date.parse(event.created_at)).filter(Number.isFinite);
  return times.length > 0 ? Math.max(...times) : null;
}

// ageMinutes: minutes since the push (or the run). marginMinutes is subtracted from every wait
// so the nudge, which asks a little later than the run itself, never disagrees with it.
export async function evaluatePullRequestStage({ client, repository, prNumber, headSha, eventName, mode, ageMinutes, timeoutMinutes, sameRepo = true, now = Date.now(), marginMinutes = 0, pullRequest = null }) {
  const facts = { eventName, mode, sameRepo, headSha, timeoutMinutes };

  const offline = decideStage({ ...facts, verdict: { state: 'none', reason: '' }, ageMinutes: 0 });
  if (DECIDED_OFFLINE.has(offline.code)) return { decision: offline, verdict: null };

  let pr = pullRequest;
  try {
    pr ??= await client.get(`/repos/${repository}/pulls/${prNumber}`);
  } catch (error) {
    // Without the pull request we cannot tell a draft from a ready one: no timeout either.
    return { decision: decideStage({ ...facts, ageMinutes: 0, apiError: error.message }), verdict: null };
  }

  let age = ageMinutes - marginMinutes;
  if (!pr.draft && age >= timeoutMinutes) {
    try {
      const readyAt = await lastReadyForReview(client, repository, prNumber);
      if (readyAt !== null) age = Math.min(age, (now - readyAt) / 60000 - marginMinutes);
    } catch {
      age = 0;
    }
  }

  const live = {
    ...facts,
    ageMinutes: age,
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
