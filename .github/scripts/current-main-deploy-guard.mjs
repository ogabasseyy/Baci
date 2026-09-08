#!/usr/bin/env node
import { fileURLToPath } from 'node:url';

const SHA_PATTERN = /^[0-9a-f]{40}$/i;
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const ROOT_WEB_FILES = new Set([
  '.npmrc',
  '.vercelignore',
  'biome.json',
  'next.config.test.ts',
  'next.config.ts',
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'turbo.json',
  'vercel.json',
]);
const WEB_PREFIXES = [
  '.github/actions/pnpm-install-cached/',
  '.github/actions/postdeploy-migrations/',
  'apps/web/',
  'infra/cwv-runner/',
  'packages/shared/',
  'public/badges/',
  'supabase/migrations/',
];
const WEB_WORKFLOW_FILES = new Set([
  '.github/filters/deploy.yml',
  '.github/scripts/blog-smoke-check.mjs',
  '.github/scripts/apply-atomic-migration-group.sh',
  '.github/scripts/apply-pending-migration.sh',
  '.github/scripts/repair-sales-migration-collision.sh',
  '.github/scripts/apply-pending-migrations.sh',
  '.github/scripts/cloudflare-purge-cache.mjs',
  '.github/scripts/current-main-deploy-guard.mjs',
  '.github/scripts/deploy-with-retry.sh',
  '.github/scripts/deferred-production-migrations.sh',
  '.github/scripts/pending-postdeploy-migrations.sh',
  '.github/scripts/assert-vercel-pulled-sensitive-env.mjs',
  '.github/scripts/assert-vercel-pulled-sensitive-env.test.mjs',
  '.github/scripts/inject-prebuilt-env-secret.mjs',
  '.github/scripts/merge-static-union.sh',
  '.github/scripts/merge-static-union.test.sh',
  '.github/scripts/pnpm-install-with-retry.sh',
  '.github/scripts/run-pinned-vercel.sh',
  '.github/scripts/storefront-release-coherence.mjs',
  '.github/scripts/storefront-release-config.mjs',
  '.github/scripts/storefront-release-marker.mjs',
  '.github/scripts/storefront-sitemap-purge.mjs',
  '.github/scripts/sync-cloudflare-vercel-production-env.sh',
  '.github/scripts/sync-cloudflare-vercel-production-env.test.mjs',
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

async function supersedingChangesAreNonWeb({
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
    comparison?.merge_base_commit?.sha?.toLowerCase() !==
      expectedSha.toLowerCase() ||
    !Number.isSafeInteger(comparison?.total_commits) ||
    comparison.total_commits < 1 ||
    comparison.total_commits > 100 ||
    !Array.isArray(comparison?.files) ||
    comparison.files.length >= 300
  ) {
    throw new Error('incomplete or non-ancestral superseding comparison');
  }
  for (const file of comparison.files) {
    const paths = [file?.filename, file?.previous_filename].filter(Boolean);
    if (paths.length === 0 || paths.some((path) => isWebDeployPath(path))) {
      return false;
    }
  }
  return true;
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
    const nonWebOnly = await supersedingChangesAreNonWeb({
      apiRoot,
      currentSha,
      expectedSha,
      fetchImpl,
      repository,
      token,
    });
    if (!nonWebOnly) {
      throw new Error(
        `superseded deployment SHA ${expectedSha}; current main is ${currentSha}`
      );
    }
  }

  return { currentSha, expectedSha };
}

function escapeWorkflowCommand(value) {
  return value
    .replaceAll('%', '%25')
    .replaceAll('\r', '%0D')
    .replaceAll('\n', '%0A');
}

async function main() {
  try {
    const result = await verifyCurrentMainDeployment({
      apiUrl: process.env.GITHUB_API_URL,
      expectedSha: process.env.GITHUB_SHA,
      repository: process.env.GITHUB_REPOSITORY,
      token: process.env.GITHUB_TOKEN,
    });
    console.log(
      `Exact-main deployment guard accepted ${result.expectedSha} for production.`
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown refusal';
    console.error(
      `::error title=Production deployment refused::${escapeWorkflowCommand(message)}`
    );
    process.exitCode = 78;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
