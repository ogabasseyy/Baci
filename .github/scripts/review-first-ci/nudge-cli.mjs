// Entry point of the "Review-first CI nudge" workflow: works out which pull
// requests an event is about, then asks nudge.mjs to re-run each one if it is time.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createGithubClient } from './github-api.mjs';
import { nudgePullRequest, sweepRecentRuns } from './nudge.mjs';
import { BREAK_GLASS_LABEL, parseTimeoutMinutes, sweepLookbackMs } from './stage-decision.mjs';

const MAY_BREAK_GLASS = new Set(['OWNER', 'MEMBER', 'COLLABORATOR']);

export function pullRequestTargets(eventName, payload) {
  switch (eventName) {
    case 'issue_comment':
      return payload.issue?.pull_request ? [payload.issue.number] : [];
    case 'pull_request_target':
      return payload.pull_request ? [payload.pull_request.number] : [];
    case 'workflow_run':
      return (payload.workflow_run?.pull_requests ?? []).map((pr) => pr.number);
    case 'schedule':
      return 'sweep';
    case 'workflow_dispatch': {
      const raw = String(payload.inputs?.pr_number ?? '').trim();
      if (raw === '') return 'sweep';
      return /^\d+$/.test(raw) ? [Number(raw)] : [];
    }
    default:
      return [];
  }
}

export function isCiNowCommand(payload) {
  const comment = payload.comment;
  return Boolean(comment) && /^\/ci-now(\s|$)/.test(String(comment.body ?? '')) && MAY_BREAK_GLASS.has(comment.author_association);
}

export async function runNudge({ env, client, now = Date.now(), log = console.log }) {
  const payload = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8'));
  const targets = pullRequestTargets(env.EVENT_NAME, payload);
  const timeoutMinutes = parseTimeoutMinutes(env.BACI_CODEX_WAIT_TIMEOUT_MINUTES);
  const repository = env.GITHUB_REPOSITORY;
  const github = client ?? createGithubClient({ token: env.GITHUB_TOKEN, apiUrl: env.GITHUB_API_URL });
  const nudge = (prNumber) =>
    nudgePullRequest({
      client: github,
      repository,
      prNumber,
      mode: env.BACI_REVIEW_FIRST_CI,
      now,
      timeoutMinutes,
      dryRun: env.DRY_RUN === 'true',
      log,
    });

  if (targets === 'sweep') {
    return sweepRecentRuns({ client: github, repository, since: new Date(now - sweepLookbackMs(timeoutMinutes)).toISOString(), nudge, log });
  }
  const results = [];
  for (const prNumber of targets) {
    if (env.EVENT_NAME === 'issue_comment' && isCiNowCommand(payload) && env.DRY_RUN !== 'true') {
      await github.post(`/repos/${repository}/issues/${prNumber}/labels`, { labels: [BREAK_GLASS_LABEL] });
      log(`PR ${prNumber}: added the ${BREAK_GLASS_LABEL} label for /ci-now`);
    }
    const result = { prNumber, ...(await nudge(prNumber)) };
    log(`PR ${prNumber}: ${result.action} (${result.reason})`);
    results.push(result);
  }
  return results;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runNudge({ env: process.env }).catch((error) => {
    console.error(`::error title=Review-first CI nudge::${String(error.message).replace(/\s+/g, ' ')}`);
    process.exit(1);
  });
}
