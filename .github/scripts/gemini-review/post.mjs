// Turns what happened into the `Gemini review` commit status (and a PR review when there is one).
//   success  reviewed, no critical/high finding        failure  reviewed, critical/high finding
//   error    Gemini could not review (quota, outage, bad config): an ABSTENTION. Diff Guardian
//            ignores it and the job stays green, so an outage never reads as "Gemini found a problem".
// Only `failure` fails the job. This step holds a GitHub token and NO Gemini key.
// Env in: GH_TOKEN, GITHUB_REPOSITORY, PR_NUMBER, HEAD_SHA, FINGERPRINT, ACTION, CARRY_STATE,
//   CARRY_SHA, COLLECT_OUTCOME, SHOULD_REVIEW, RESPONSE_FILE, CHANGED_FILES_FILE, RUN_URL,
//   GITHUB_STEP_SUMMARY.
import { appendFileSync, readFileSync } from 'node:fs';
import { isMain, parseJson } from './cli.mjs';
import { githubClient } from './github.mjs';
import { buildMarker, formatUsage, parseReview, renderReview, reviewState } from './review.mjs';
import { sanitizeText } from './sanitize.mjs';

const CONTEXT = 'Gemini review';

const NOT_COUNTED = {
  quota_daily: 'Gemini quota used up (free-tier key?): not counted',
  quota_rate: 'Gemini rate-limited: not counted',
  unavailable: 'Gemini unavailable: not counted',
  timeout: 'Gemini timed out: not counted',
  auth: 'Gemini key rejected, check GEMINI_API_KEY: not counted',
  model_not_found: 'Gemini model not found, check GEMINI_MODEL: not counted',
  bad_request: 'Gemini rejected the request: not counted',
  blocked: 'Gemini blocked the prompt: not counted',
  incomplete: 'Gemini answer was cut off: not counted',
  empty: 'Gemini answered with nothing: not counted',
  unknown: 'Gemini failed unexpectedly: not counted',
};

const abstain = (description, why) => ({ state: 'error', description, why });
const carriedState = (env) => (env.CARRY_STATE === 'failure' ? 'failure' : 'success');

function evaluateReview(env, readFile) {
  const response = parseJson(readFileSafe(readFile, env.RESPONSE_FILE), null);
  if (!response) return abstain('Gemini review did not run: not counted', 'no response was recorded');
  if (!response.ok) {
    return abstain(NOT_COUNTED[response.kind] ?? NOT_COUNTED.unknown, `${response.kind}: ${sanitizeText(response.detail, { max: 200 })}`);
  }
  const parsed = parseReview(response.text);
  if (!parsed.ok) return abstain('Gemini returned an unreadable review: not counted', `unreadable answer (${parsed.reason})`);
  const changedFiles = readFileSafe(readFile, env.CHANGED_FILES_FILE).split('\n').map((line) => line.trim()).filter(Boolean);
  // Without the list no path can be verified; do not trust every path a model names.
  if (changedFiles.length === 0) {
    return abstain('Changed-file list unavailable: Gemini review not counted', 'the changed-file list is empty or unreadable');
  }
  const state = reviewState(parsed.review, changedFiles);
  const unreviewable = Number.parseInt(env.UNREVIEWABLE_FILES, 10) || 0;
  if (state === 'success' && unreviewable > 0) {
    // File names with control characters are hidden from the model, so a clean answer proves nothing.
    return {
      state: 'error',
      description: 'Some file names could not be read by Gemini: not counted',
      why: `${unreviewable} file name(s) with control characters were not reviewed`,
      review: parsed.review,
      response,
      changedFiles,
      unreviewable,
    };
  }
  return {
    state,
    description: state === 'failure' ? 'HIGH/CRITICAL findings flagged by Gemini' : 'No HIGH/CRITICAL findings',
    review: parsed.review,
    response,
    changedFiles,
  };
}

function readFileSafe(readFile, path) {
  try {
    return readFile(path, 'utf8');
  } catch {
    return '';
  }
}

function evaluate(env, readFile) {
  if (env.COLLECT_OUTCOME !== 'success') {
    return abstain('Gemini could not read the pull request: not counted', `collect step ${env.COLLECT_OUTCOME || 'did not run'}`);
  }
  switch (env.ACTION) {
    case 'bypass':
      return { state: 'success', description: 'Bypassed via bypass-ai-gate label' };
    case 'no_diff':
      return abstain('Pull request diff could not be read: not counted', 'the diff was empty or refused by the API');
    case 'blocked_private':
      return abstain('Not sent to Gemini: private repo without GEMINI_PAID_TIER_CONFIRMED', 'private repository, key tier not confirmed');
    case 'duplicate':
      return { state: carriedState(env), description: 'This commit was already reviewed by Gemini', carried: true };
    case 'unchanged':
      return { state: carriedState(env), description: `Merge only, same changes as ${String(env.CARRY_SHA).slice(0, 7)}: earlier review applies`, carried: true };
    case 'review':
      return evaluateReview(env, readFile);
    default:
      return abstain('Gemini review skipped: decision step failed', 'decide step did not report an action');
  }
}

function reviewBody({ outcome, env, now }) {
  const { response, review, changedFiles, state } = outcome;
  const model = /^[a-z0-9][a-z0-9.-]{0,62}$/.test(String(response.model)) ? response.model : 'unknown';
  return [
    // Only a counted result is remembered; later pushes ignore a review without a marker.
    ...(state === 'error' ? [] : [buildMarker({ sha: env.HEAD_SHA, fingerprint: env.FINGERPRINT, state })]),
    '## Gemini code review',
    '',
    `Model: \`${model}\` · ${formatUsage(model, response.usage, now())} · Workflow: ${env.RUN_URL}`,
    ...(outcome.unreviewable ? ['', `> ${outcome.unreviewable} changed file(s) have names with control characters and were not reviewed, so this review is not counted.`] : []),
    '',
    renderReview({ review, changedFiles }),
  ].join('\n');
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// A lost status write is an infrastructure miss, not a finding: retry once, then warn. The job's
// result still follows the review (only a finding fails it), so a GitHub hiccup cannot make a
// clean review look like a blocking one.
async function writeStatus({ github, env, payload, log, sleep }) {
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      await github.post(`statuses/${env.HEAD_SHA}`, payload);
      return true;
    } catch (error) {
      if (attempt === 2) {
        log(`::warning::Could not write the Gemini review status (${error.message}); Diff Guardian will not see this vote.`);
        return false;
      }
      await sleep(2000);
    }
  }
  return false;
}

export async function post({ env, github, log = console.log, now = () => new Date().toISOString(), readFile = readFileSync, appendFile = appendFileSync, sleep = defaultSleep }) {
  if (env.SHOULD_REVIEW === 'false') {
    log('::notice::The pull request is not open any more; nothing to report.');
    return { state: null, exitCode: 0 };
  }
  if (!env.HEAD_SHA) {
    // Only a manual comment run can get here (collect failed before it learned the head commit).
    // There is no commit to put a status on, and an outage must not turn the job red.
    log('::warning::No head commit is known (the pull request could not be read), so no Gemini review status can be set. Nothing is counted.');
    return { state: null, exitCode: 0 };
  }

  const outcome = evaluate(env, readFile);
  const { state } = outcome;

  if (outcome.review && env.PR_NUMBER) {
    try {
      await github.post(`pulls/${env.PR_NUMBER}/reviews`, { body: reviewBody({ outcome, env, now }), event: 'COMMENT', commit_id: env.HEAD_SHA });
    } catch (error) {
      log(`::warning::Could not post the Gemini review comment: ${error.message}`);
    }
  }
  await writeStatus({
    github,
    env,
    log,
    sleep,
    payload: { state, context: CONTEXT, description: outcome.description.slice(0, 140), target_url: env.RUN_URL },
  });

  if (state === 'failure') {
    log("::error::Gemini flagged HIGH/CRITICAL findings on this PR. Address them before merge, or add the 'bypass-ai-gate' label.");
    for (const finding of outcome.review?.findings ?? []) {
      if (finding.severity === 'critical' || finding.severity === 'high') {
        log(`- ${finding.severity}: ${sanitizeText(finding.title, { max: 200 })} in ${sanitizeText(finding.path, { max: 200 })}:${finding.line}`);
      }
    }
  } else if (state === 'error') {
    log(`::warning::Gemini review not counted (${outcome.why}). The job stays green and Diff Guardian ignores this reviewer for this commit.`);
  }

  const usage = outcome.response ? `, ${formatUsage(outcome.response.model, outcome.response.usage, now())}` : '';
  appendFile(env.GITHUB_STEP_SUMMARY || '/dev/null', `### Gemini review: ${state}\n\n${outcome.description}${usage}\n`);
  return { state, exitCode: state === 'failure' ? 1 : 0 };
}

if (isMain(import.meta.url)) {
  const env = process.env;
  const github = githubClient({ token: env.GH_TOKEN, repo: env.GITHUB_REPOSITORY, apiUrl: env.GITHUB_API_URL });
  const result = await post({ env, github });
  process.exitCode = result.exitCode;
}
