#!/usr/bin/env node
import { fileURLToPath } from 'node:url';

const SHA_PATTERN = /^[0-9a-f]{40}$/i;
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const ROOT_WEB_FILES = new Set([
  '.npmrc', '.vercelignore', 'biome.json', 'next.config.test.ts',
  'next.config.ts', 'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml',
  'turbo.json', 'vercel.json',
]);
const WEB_PREFIXES = [
  '.github/actions/pnpm-install-cached/',
  '.github/actions/postdeploy-migrations/',
  'apps/web/',
  'infra/cwv-runner/',
  'packages/shared/',
  'public/badges/',
  'public/guides/',
  'supabase/migrations/',
];
const WEB_WORKFLOW_FILES = new Set([
  '.github/filters/deploy.yml', '.github/scripts/assert-guide-prebuilt.mjs',
  '.github/scripts/assert-guide-prebuilt.test.mjs', '.github/scripts/blog-smoke-check.mjs',
  '.github/scripts/apply-atomic-migration-group.sh', '.github/scripts/apply-pending-migration.sh',
  '.github/scripts/repair-sales-migration-collision.sh', '.github/scripts/apply-pending-migrations.sh',
  '.github/scripts/cloudflare-purge-cache.mjs', '.github/scripts/current-main-deploy-guard.mjs',
  '.github/scripts/deploy-with-retry.sh', '.github/scripts/deploy-with-retry-overlap.sh',
  '.github/scripts/refuse-publish-on-promote-overlap.sh', '.github/scripts/probe-gigl-hook-reload.sh',
  '.github/scripts/check-gigl-cutover-latch.sh', '.github/scripts/refresh-gigl-cutover-latch.sh',
  '.github/scripts/check-production-release-outcome.mjs', '.github/scripts/resolve-gigl-latch-identity.sh',
  '.github/scripts/smoke-gigl-worker-capability.sh', '.github/scripts/verify-gigl-fallback-token.sh',
  '.github/scripts/verify-gigl-worker-final-state.sh', '.github/scripts/verify-coordinated-release.sh',
  '.github/scripts/gigl-dotenv.sh', '.github/scripts/deferred-production-migrations.sh',
  '.github/scripts/pending-postdeploy-migrations.sh', '.github/scripts/assert-vercel-pulled-sensitive-env.mjs',
  '.github/scripts/assert-vercel-pulled-sensitive-env.test.mjs', '.github/scripts/normalize-vercel-sensitive-placeholders.mjs',
  '.github/scripts/normalize-vercel-sensitive-placeholders.test.mjs', '.github/scripts/ensure-vercel-sensitive-env.mjs',
  '.github/scripts/ensure-vercel-sensitive-env.test.mjs', '.github/scripts/inject-prebuilt-env-secret.mjs',
  '.github/scripts/merge-static-union.sh', '.github/scripts/merge-static-union.test.sh',
  '.github/scripts/pnpm-install-with-retry.sh', '.github/scripts/run-pinned-vercel.sh',
  '.github/scripts/storefront-release-coherence.mjs', '.github/scripts/storefront-release-config.mjs',
  '.github/scripts/storefront-release-marker.mjs', '.github/scripts/storefront-sitemap-purge.mjs',
  '.github/scripts/sync-cloudflare-vercel-production-env.sh', '.github/scripts/sync-cloudflare-vercel-production-env.test.mjs',
  '.github/workflows/deploy.yml',
]);

function required(value, label) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`missing ${label}`);
  }
  return value;
}

function safeApiUrl(value) {
  const url = new URL(value ?? 'https://api.github.com');
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new Error('invalid GitHub API URL');
  }
  return url.href.replace(/\/$/, '');
}

function isWebDeployPath(path) {
  return (
    ROOT_WEB_FILES.has(path) ||
    WEB_WORKFLOW_FILES.has(path) ||
    /^tsconfig[^/]*\.json$/.test(path) ||
    WEB_PREFIXES.some((prefix) => path.startsWith(prefix))
  );
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
  if (!response.ok) {
    throw new Error(`GitHub lookup failed with status ${response.status}`);
  }
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
  if (run?.status === 'queued' && Number.isSafeInteger(run.run_attempt) && run.run_attempt <= 1) {
    return false;
  }
  if (!Number.isSafeInteger(run?.id) || run.id <= 0) {
    throw new Error('invalid workflow run id');
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
  for (const job of jobsBody.jobs) {
    if (job?.name !== 'deploy-production') continue;
    if (job.conclusion === 'success') return true;
    if (job.conclusion !== 'skipped') {
      if (Array.isArray(job.steps) && job.steps.length > 0) {
        const deployStep = job.steps.find((s) => s?.name === 'Deploy to Vercel (with retry)');
        const attempted =
          deployStep?.status === 'in_progress' ||
          (Boolean(deployStep?.conclusion) && deployStep.conclusion !== 'skipped');
        if (attempted) return true;
        if (job.status === 'completed' && !deployStep) {
          throw new Error('missing Deploy to Vercel step in deploy-production job');
        }
      } else if (job.status === 'completed') {
        throw new Error('incomplete or invalid workflow job steps response');
      }
    }
  }
  return false;
}

// Residual risk note: tracks canonical deploy.yml workflow runs on main. Manual emergency
// runs executed outside GitHub Actions do not leave runs records.
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
      `${apiRoot}/repos/${repository}/actions/workflows/deploy.yml/runs?head_sha=${sha}&per_page=100`,
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
      if (run.head_sha.toLowerCase() === sha.toLowerCase()) {
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
    !Number.isSafeInteger(comparison?.total_commits) ||
    comparison.total_commits < 1 ||
    comparison.total_commits > 100 ||
    !Array.isArray(comparison?.files) ||
    comparison.files.length >= 300
  ) {
    throw new Error('incomplete or non-ancestral superseding comparison');
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
