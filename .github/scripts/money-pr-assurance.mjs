#!/usr/bin/env node
// Entry point for .github/workflows/money-pr-assurance.yml. Evaluates the
// money-path assurance requirements for one PR (or every open PR at a head
// commit) and posts the result as the "money-pr-assurance" commit status.
//
// Environment: GITHUB_TOKEN, GITHUB_REPOSITORY, PR_NUMBER and/or HEAD_SHA,
// optional GITHUB_API_URL, RUN_URL, GITHUB_STEP_SUMMARY, DRY_RUN=1 and
// ASSURANCE_CONFIG (defaults to .github/money-path-paths.json). With both,
// HEAD_SHA is the event's head commit: if the PR cannot be read, an error
// status goes there so an earlier success never outlives a failed check.
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import { loadAssuranceConfig } from './money-pr-assurance-config.mjs';
import { evaluateAssurance } from './money-pr-assurance-evaluate.mjs';
import {
  collectSnapshot,
  createGitHubClient,
  findOpenPullRequestsForSha,
  postStatus,
  readPullRequest,
} from './money-pr-assurance-github.mjs';

const READ_ATTEMPTS = 3;
const FIRST_RETRY_MS = 2000;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetries(read, sleep) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await read();
    } catch (error) {
      if (attempt >= READ_ATTEMPTS) throw error;
      await sleep(FIRST_RETRY_MS * 2 ** (attempt - 1));
    }
  }
}

export function resolveTarget(env) {
  const [owner, repo, extra] = String(env.GITHUB_REPOSITORY ?? '').split('/');
  if (!owner || !repo || extra !== undefined)
    throw new Error('GITHUB_REPOSITORY must look like owner/repo');
  const prText = String(env.PR_NUMBER ?? '').trim();
  const shaText = String(env.HEAD_SHA ?? '')
    .trim()
    .toLowerCase();
  if (shaText && !/^[0-9a-f]{40}$/.test(shaText))
    throw new Error('HEAD_SHA must be a full commit SHA');
  const headSha = shaText || null;
  if (prText) {
    if (!/^[1-9][0-9]{0,9}$/.test(prText))
      throw new Error('PR_NUMBER must be a positive integer');
    return { owner, repo, prNumber: Number(prText), headSha };
  }
  if (headSha) return { owner, repo, prNumber: null, headSha };
  throw new Error(
    'Set PR_NUMBER or HEAD_SHA to choose the pull request to evaluate'
  );
}

function renderSummary(number, sha, result) {
  const lines = [
    `### money-pr-assurance for #${number} at ${sha.slice(0, 7)}: ${result.state}`,
    '',
    result.description,
  ];
  if (result.moneyFiles?.length) {
    lines.push(
      '',
      `Money-path files: ${result.moneyFiles.length} (first: ${result.moneyFiles[0].replace(/\p{Cc}+/gu, ' ')})`
    );
  }
  if (result.reviewers) {
    lines.push(
      '',
      ...Object.entries(result.reviewers).map(
        ([name, { state, detail }]) => `- ${name}: ${state} (${detail})`
      )
    );
  }
  if (result.reasons?.length)
    lines.push(
      '',
      'Unmet requirements:',
      ...result.reasons.map((reason) => `- ${reason}`)
    );
  if (result.pending?.length)
    lines.push(
      '',
      'Still running:',
      ...result.pending.map((item) => `- ${item}`)
    );
  return `${lines.join('\n')}\n`;
}

export async function runAssurance({
  env,
  fetchImpl,
  config,
  appendSummary,
  log,
  sleep = wait,
}) {
  const target = resolveTarget(env);
  const client = createGitHubClient({
    token: env.GITHUB_TOKEN,
    fetchImpl,
    apiUrl: env.GITHUB_API_URL || 'https://api.github.com',
  });
  const dryRun = env.DRY_RUN === '1';
  const postError = (sha) =>
    postStatus(client, {
      owner: target.owner,
      repo: target.repo,
      sha,
      state: 'error',
      description: 'Assurance could not be evaluated; see the workflow run',
      context: config.statusContext,
      targetUrl: env.RUN_URL,
    }).catch((failure) =>
      log(`::warning::Could not post the error status: ${failure.message}`)
    );
  let numbers;
  try {
    numbers = target.prNumber
      ? [target.prNumber]
      : await withRetries(
          () =>
            findOpenPullRequestsForSha(client, {
              owner: target.owner,
              repo: target.repo,
              sha: target.headSha,
            }),
          sleep
        );
  } catch (error) {
    log(`::error::money-pr-assurance could not list PRs: ${error.message}`);
    if (!dryRun) await postError(target.headSha);
    return { results: [], exitCode: 1 };
  }
  if (numbers.length === 0)
    log(
      'No open pull request is associated with this commit; nothing to evaluate.'
    );

  const results = [];
  let exitCode = 0;
  for (const number of numbers) {
    let sha = null;
    try {
      const pr = await withRetries(
        () =>
          readPullRequest(client, {
            owner: target.owner,
            repo: target.repo,
            number,
          }),
        sleep
      );
      sha = pr.headSha;
      if (pr.state !== 'open') {
        log(`#${number} is ${pr.state}; skipping.`);
        continue;
      }
      const snapshot = await collectSnapshot(
        client,
        { owner: target.owner, repo: target.repo, number },
        config,
        pr
      );
      const result = evaluateAssurance(snapshot, config);
      results.push({
        number,
        sha,
        state: result.state,
        description: result.description,
      });
      appendSummary(renderSummary(number, sha, result));
      log(`#${number} ${sha}: ${result.state} - ${result.description}`);
      if (!dryRun) {
        await postStatus(client, {
          owner: target.owner,
          repo: target.repo,
          sha,
          state: result.state,
          description: result.description,
          context: config.statusContext,
          targetUrl: env.RUN_URL,
        });
      }
    } catch (error) {
      exitCode = 1;
      log(
        `::error::money-pr-assurance could not evaluate #${number}: ${error.message}`
      );
      results.push({ number, sha, state: 'error', description: error.message });
      // Fall back to the event's head commit when the PR itself was unread.
      const statusSha = sha ?? target.headSha;
      if (statusSha && !dryRun) await postError(statusSha);
    }
  }
  return { results, exitCode };
}

async function main() {
  const env = process.env;
  const config = loadAssuranceConfig(
    env.ASSURANCE_CONFIG || '.github/money-path-paths.json'
  );
  const { exitCode } = await runAssurance({
    env,
    fetchImpl: fetch,
    config,
    appendSummary: (text) => {
      if (env.GITHUB_STEP_SUMMARY)
        appendFileSync(env.GITHUB_STEP_SUMMARY, text);
    },
    log: (line) => console.log(line),
  });
  process.exitCode = exitCode;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    console.error(`::error::${error.message}`);
    process.exitCode = 1;
  });
}
