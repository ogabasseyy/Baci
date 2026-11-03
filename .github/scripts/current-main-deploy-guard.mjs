#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { descendantAlreadyDeployed } from './deploy-guard-descendants.mjs';

const SHA_PATTERN = /^[0-9a-f]{40}$/i;
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export function validateDeployPattern(pat) {
  if (/\s|#|[!?{}[\]()+@]/.test(pat) || (pat.endsWith('/**') ? pat.slice(0, -3).includes('*') : pat.indexOf('*') !== pat.lastIndexOf('*'))) {
    throw new Error(`unsupported glob: ${pat}`);
  }
}

function loadDeployPatterns() {
  const text = readFileSync(new URL('../filters/deploy.yml', import.meta.url), 'utf8');
  const patterns = [];
  let section = null;
  let webCount = 0;
  let migrationsCount = 0;
  for (const line of text.split('\n')) {
    if (/^[^\s#][^:\n]*:/.test(line)) {
      section = line.startsWith('web:') ? 'web' : line.startsWith('migrations:') ? 'migrations' : null;
    } else if (section && /^\s*-\s*['"]?([^'"]+)['"]?/.test(line)) {
      const pat = line.match(/^\s*-\s*['"]?([^'"]+)['"]?/)[1];
      validateDeployPattern(pat);
      patterns.push(pat);
      section === 'web' ? webCount++ : migrationsCount++;
    } else if (section && line.trim() && !line.trim().startsWith('#')) {
      throw new Error(`unsupported line format in deploy filter: ${line}`);
    }
  }
  if (webCount === 0 || migrationsCount === 0) throw new Error('deploy filter web or migrations patterns underloaded');
  return patterns;
}

let deployPatternsCache = null;
export function getDeployPatterns() {
  return (deployPatternsCache ??= loadDeployPatterns());
}
export const DEPLOY_PATTERNS = new Proxy([], {
  get: (_, prop) => Reflect.get(getDeployPatterns(), prop),
  has: (_, prop) => Reflect.has(getDeployPatterns(), prop),
});

function isWebDeployPath(path) {
  const normPath = path.replace(/\/+/g, '/');
  return getDeployPatterns().some((pat) => {
    if (pat.endsWith('/**')) return normPath.startsWith(pat.slice(0, -2));
    if (pat.includes('*')) {
      const [p, s] = pat.split('*');
      return normPath.length >= p.length + s.length && normPath.startsWith(p) && normPath.endsWith(s) &&
        !normPath.slice(p.length, normPath.length - s.length).includes('/');
    }
    return normPath === pat;
  });
}

function required(value, label) {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`missing ${label}`);
  return value;
}

function safeApiUrl(value) {
  const url = new URL(value ?? 'https://api.github.com');
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('invalid GitHub API URL');
  return url.href.replace(/\/$/, '');
}

async function githubJson(fetchImpl, url, token) {
  const response = await fetchImpl(url, {
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      'user-agent': 'baci-current-main-deploy-guard',
      'x-github-api-version': '2022-11-28',
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`GitHub lookup failed with status ${response.status}`);
  return response.json();
}

function collectSupersedingShas(comparison, currentSha) {
  const shas = new Set([currentSha.toLowerCase()]);
  if (Array.isArray(comparison.commits)) {
    if (comparison.commits.length !== comparison.total_commits) {
      throw new Error('incomplete superseding commit list');
    }
    for (let i = comparison.commits.length - 1; i >= 0; i--) {
      const commit = comparison.commits[i];
      if (typeof commit?.sha !== 'string' || !SHA_PATTERN.test(commit.sha)) {
        throw new Error('invalid superseding commit SHA');
      }
      shas.add(commit.sha.toLowerCase());
    }
  } else if (comparison.total_commits > 1) {
    throw new Error('incomplete superseding commit list');
  }
  return shas;
}

async function runHasDeployedProduction(fetchImpl, apiRoot, repository, run, token) {
  if (!Number.isSafeInteger(run?.id) || run.id <= 0) {
    throw new Error('invalid workflow run id');
  }
  if (run?.status === 'queued' && Number.isSafeInteger(run.run_attempt) && run.run_attempt <= 1) {
    return false;
  }
  const jobsBody = await githubJson(
    fetchImpl,
    `${apiRoot}/repos/${repository}/actions/runs/${run.id}/jobs?filter=all&per_page=100`,
    token
  );
  if (
    !Array.isArray(jobsBody?.jobs) ||
    (typeof jobsBody?.total_count === 'number' && jobsBody.total_count > jobsBody.jobs.length)
  ) {
    throw new Error('incomplete or invalid workflow jobs response');
  }
  const deployJobs = jobsBody.jobs.filter((j) => j?.name === 'deploy-production');
  if (deployJobs.length === 0) {
    if (run.status === 'completed' && (run.conclusion !== 'cancelled' || jobsBody.jobs.length > 0)) {
      throw new Error('missing deploy-production job in workflow run');
    }
    return false;
  }
  for (const deployJob of deployJobs) {
    if (deployJob.conclusion === 'success') return true;
    if (deployJob.conclusion !== 'skipped') {
      if (Array.isArray(deployJob.steps) && deployJob.steps.length > 0) {
        const deployStep = deployJob.steps.find((s) => s?.name === 'Deploy to Vercel (with retry)');
        if (!deployStep) {
          throw new Error('missing Deploy to Vercel step in deploy-production job');
        }
        const attempted =
          deployStep.status === 'in_progress' ||
          (Boolean(deployStep.conclusion) && deployStep.conclusion !== 'skipped');
        if (attempted) return true;
      } else if (deployJob.status !== 'queued' && deployJob.conclusion !== 'cancelled') {
        throw new Error('incomplete or invalid workflow job steps response');
      }
    }
  }
  return false;
}

// Residual risk note: tracks canonical deploy.yml workflow runs on main. Manual emergency
// runs executed outside GitHub Actions leave no workflow run records and are accepted as an
// operational rollback window.
async function hasSupersedingDeployment({
  apiRoot,
  fetchImpl,
  repository,
  supersedingShas,
  token,
}) {
  for (const sha of supersedingShas) {
    const runsBody = await githubJson(
      fetchImpl,
      `${apiRoot}/repos/${repository}/actions/workflows/deploy.yml/runs?head_sha=${sha}&branch=main&per_page=100`,
      token
    );
    if (
      !Array.isArray(runsBody?.workflow_runs) ||
      (typeof runsBody?.total_count === 'number' &&
        runsBody.total_count > runsBody.workflow_runs.length)
    ) {
      throw new Error('incomplete or invalid workflow runs response');
    }
    for (const run of runsBody.workflow_runs) {
      if (typeof run?.head_sha !== 'string' || !SHA_PATTERN.test(run.head_sha)) {
        throw new Error('invalid workflow run SHA');
      }
      if (
        run.head_sha.toLowerCase() === sha.toLowerCase() &&
        (run.head_branch == null || run.head_branch === 'main')
      ) {
        const deployed = await runHasDeployedProduction(fetchImpl, apiRoot, repository, run, token);
        if (deployed) return true;
      }
    }
  }
  return false;
}

async function supersedingChangesCanProceed({
  apiRoot,
  currentSha,
  expectedSha,
  fetchImpl,
  repository,
  token,
}) {
  const comparison = await githubJson(
    fetchImpl,
    `${apiRoot}/repos/${repository}/compare/${expectedSha}...${currentSha}?per_page=100&page=1`,
    token
  );
  if (
    comparison?.status !== 'ahead' ||
    comparison?.merge_base_commit?.sha?.toLowerCase() !== expectedSha.toLowerCase() ||
    !(Number.isSafeInteger(comparison?.total_commits) && comparison.total_commits >= 1) ||
    (comparison.files != null && !Array.isArray(comparison.files))
  ) {
    throw new Error('incomplete or non-ancestral superseding comparison');
  }
  if (comparison.total_commits > 100 || !(comparison.files?.length < 300)) {
    return !(await descendantAlreadyDeployed({ apiRoot, comparison, currentSha, expectedSha, fetchImpl, githubJson, repository, runHasDeployedProduction, token }));
  }
  let nonWebOnly = true;
  for (const file of comparison.files) {
    const paths = [file?.filename, file?.previous_filename].filter(Boolean);
    if (paths.length === 0 || paths.some((path) => isWebDeployPath(path))) {
      nonWebOnly = false;
      break;
    }
  }
  if (nonWebOnly) {
    return true;
  }
  const supersedingShas = collectSupersedingShas(comparison, currentSha);
  const alreadyDeployed = await hasSupersedingDeployment({
    apiRoot,
    fetchImpl,
    repository,
    supersedingShas,
    token,
  });
  return !alreadyDeployed;
}

export async function verifyCurrentMainDeployment({
  apiUrl,
  expectedSha,
  fetchImpl = globalThis.fetch,
  repository,
  token,
}) {
  if (!SHA_PATTERN.test(required(expectedSha, 'deployment SHA'))) {
    throw new Error('invalid deployment SHA');
  }
  if (!REPOSITORY_PATTERN.test(required(repository, 'GitHub repository'))) {
    throw new Error('invalid GitHub repository');
  }
  required(token, 'GitHub token');
  if (typeof fetchImpl !== 'function') {
    throw new Error('fetch is unavailable');
  }

  const apiRoot = safeApiUrl(apiUrl);
  const body = await githubJson(
    fetchImpl,
    `${apiRoot}/repos/${repository}/git/ref/heads/main`,
    token
  );
  const currentSha = body?.object?.sha;
  if (typeof currentSha !== 'string' || !SHA_PATTERN.test(currentSha)) {
    throw new Error('invalid current main SHA');
  }
  if (currentSha.toLowerCase() !== expectedSha.toLowerCase()) {
    const canProceed = await supersedingChangesCanProceed({
      apiRoot,
      currentSha,
      expectedSha,
      fetchImpl,
      repository,
      token,
    });
    if (!canProceed) {
      throw new Error(`superseded deployment SHA ${expectedSha}; current main is ${currentSha}`);
    }
  }

  return { currentSha, expectedSha };
}

function escapeWorkflowCommand(value) {
  return value.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
}

async function main() {
  try {
    const result = await verifyCurrentMainDeployment({
      apiUrl: process.env.GITHUB_API_URL,
      expectedSha: process.env.GITHUB_SHA,
      repository: process.env.GITHUB_REPOSITORY,
      token: process.env.GITHUB_TOKEN,
    });
    console.log(`Exact-main deployment guard accepted ${result.expectedSha} for production.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown refusal';
    console.error(`::error title=Production deployment refused::${escapeWorkflowCommand(message)}`);
    process.exitCode = 78;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
