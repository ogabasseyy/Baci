#!/usr/bin/env node
// Entry point for .github/workflows/money-pr-assurance.yml. Evaluates the
// money-path assurance requirements for one PR (or every open PR at a head
// commit) and posts the result as the "money-pr-assurance" commit status.
//
// Environment: GITHUB_TOKEN, GITHUB_REPOSITORY, PR_NUMBER or HEAD_SHA,
// optional GITHUB_API_URL, RUN_URL, GITHUB_STEP_SUMMARY, DRY_RUN=1 and
// ASSURANCE_CONFIG (defaults to .github/money-path-paths.json).
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

export function resolveTarget(env) {
  const [owner, repo, extra] = String(env.GITHUB_REPOSITORY ?? '').split('/');
  if (!owner || !repo || extra !== undefined)
    throw new Error('GITHUB_REPOSITORY must look like owner/repo');
  const prText = String(env.PR_NUMBER ?? '').trim();
  const shaText = String(env.HEAD_SHA ?? '')
    .trim()
    .toLowerCase();
  if (prText) {
    if (!/^[1-9][0-9]{0,9}$/.test(prText))
      throw new Error('PR_NUMBER must be a positive integer');
    return { owner, repo, prNumber: Number(prText), headSha: null };
  }
  if (shaText) {
    if (!/^[0-9a-f]{40}$/.test(shaText))
      throw new Error('HEAD_SHA must be a full commit SHA');
    return { owner, repo, prNumber: null, headSha: shaText };
  }
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
}) {
  const target = resolveTarget(env);
  const client = createGitHubClient({
    token: env.GITHUB_TOKEN,
    fetchImpl,
    apiUrl: env.GITHUB_API_URL || 'https://api.github.com',
  });
  const dryRun = env.DRY_RUN === '1';
  const numbers = target.prNumber
    ? [target.prNumber]
    : await findOpenPullRequestsForSha(client, {
        owner: target.owner,
        repo: target.repo,
        sha: target.headSha,
      });
  if (numbers.length === 0)
    log(
      'No open pull request is associated with this commit; nothing to evaluate.'
    );

  const results = [];
  let exitCode = 0;
  for (const number of numbers) {
    let sha = null;
    try {
      const pr = await readPullRequest(client, {
        owner: target.owner,
        repo: target.repo,
        number,
      });
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
      if (sha && !dryRun) {
        await postStatus(client, {
          owner: target.owner,
          repo: target.repo,
          sha,
          state: 'error',
          description: 'Assurance could not be evaluated; see the workflow run',
          context: config.statusContext,
          targetUrl: env.RUN_URL,
        }).catch((postError) =>
          log(
            `::warning::Could not post the error status: ${postError.message}`
          )
        );
      }
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
