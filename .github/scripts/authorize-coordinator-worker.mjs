import { createPublicKey, verify as verifySignature } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const RELEASE_REPOSITORY = 'ogabasseyy/Baci';
export const COORDINATOR_WORKFLOW_PATH = '.github/workflows/production-release.yml';
export const WORKER_JOB_NAME = 'Sync VPS workers';
export const WORKER_RUNNER_LABEL = 'baci-release';

function decodePart(value, label) {
  try {
    return JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
  } catch {
    throw new Error(`invalid OIDC ${label}`);
  }
}

function isPinnedCoordinatorRunPath(value) {
  return value === COORDINATOR_WORKFLOW_PATH || value === `${COORDINATOR_WORKFLOW_PATH}@main` ||
    value === `${COORDINATOR_WORKFLOW_PATH}@refs/heads/main`;
}

export function verifyGitHubActionsToken(token, jwks, { audience, now = Date.now(), expectedJobWorkflowPath = COORDINATOR_WORKFLOW_PATH } = {}) {
  if (typeof token !== 'string') throw new Error('OIDC token is required');
  const pieces = token.split('.');
  if (pieces.length !== 3) throw new Error('invalid OIDC token');
  const header = decodePart(pieces[0], 'header');
  const claims = decodePart(pieces[1], 'claims');
  if (header.alg !== 'RS256' || typeof header.kid !== 'string') throw new Error('unsupported OIDC signature');
  const key = jwks?.keys?.find((candidate) => candidate.kid === header.kid && candidate.kty === 'RSA' && candidate.use === 'sig');
  if (!key) throw new Error('OIDC signing key unavailable');
  const publicKey = createPublicKey({ key, format: 'jwk' });
  if (!verifySignature('RSA-SHA256', Buffer.from(`${pieces[0]}.${pieces[1]}`), publicKey, Buffer.from(pieces[2], 'base64url'))) {
    throw new Error('OIDC signature verification failed');
  }
  const seconds = Math.floor(now / 1000);
  if (claims.iss !== 'https://token.actions.githubusercontent.com' || claims.aud !== audience ||
      !Number.isInteger(claims.exp) || claims.exp <= seconds || !Number.isInteger(claims.nbf) || claims.nbf > seconds ||
      !Number.isInteger(claims.iat) || claims.iat > seconds + 30) {
    throw new Error('OIDC issuer, audience, or time claims invalid');
  }
  const sha = /^[0-9a-f]{40}$/;
  if (claims.repository !== RELEASE_REPOSITORY || claims.workflow_ref !== `${RELEASE_REPOSITORY}/${COORDINATOR_WORKFLOW_PATH}@refs/heads/main` ||
      claims.job_workflow_ref !== `${RELEASE_REPOSITORY}/${expectedJobWorkflowPath}@refs/heads/main` || claims.ref !== 'refs/heads/main' || claims.ref_type !== 'branch' ||
      !['push', 'workflow_dispatch'].includes(claims.event_name) || !sha.test(claims.sha ?? '') ||
      !/^[1-9][0-9]*$/.test(String(claims.run_id ?? '')) || !Number.isSafeInteger(Number(claims.run_attempt)) || Number(claims.run_attempt) < 1 ||
      !/^[1-9][0-9]*$/.test(String(claims.check_run_id ?? '')) || claims.runner_environment !== 'self-hosted') {
    throw new Error('OIDC coordinator job claims invalid');
  }
  return claims;
}

async function json(fetchImpl, url, token) {
  const response = await fetchImpl(url, { headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' } });
  if (!response.ok) throw new Error(`GitHub API request failed (${response.status})`);
  return response.json();
}

export async function authorizeCoordinatorJob({ env = process.env, fetchImpl = fetch, now = Date.now(), expectedJobName = WORKER_JOB_NAME, expectedJobWorkflowPath = COORDINATOR_WORKFLOW_PATH } = {}) {
  const requestUrl = new URL(env.ACTIONS_ID_TOKEN_REQUEST_URL ?? '');
  const requestSecret = env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  const ghToken = env.GH_TOKEN ?? env.GITHUB_TOKEN;
  if (requestUrl.protocol !== 'https:' || requestUrl.hostname !== 'pipelines.actions.githubusercontent.com' || requestUrl.username ||
      requestUrl.password || requestUrl.port || requestUrl.hash || !requestSecret || !ghToken) {
    throw new Error('GitHub Actions job identity is unavailable');
  }
  const audience = `https://github.com/${RELEASE_REPOSITORY}`;
  requestUrl.searchParams.set('audience', audience);
  const tokenResponse = await fetchImpl(requestUrl, { headers: { authorization: `Bearer ${requestSecret}` } });
  if (!tokenResponse.ok) throw new Error(`OIDC token request failed (${tokenResponse.status})`);
  const tokenBody = await tokenResponse.json();
  const oidcToken = tokenBody.value;
  const discovery = await fetchImpl('https://token.actions.githubusercontent.com/.well-known/openid-configuration');
  if (!discovery.ok) throw new Error('GitHub OIDC discovery unavailable');
  const metadata = await discovery.json();
  if (metadata.issuer !== 'https://token.actions.githubusercontent.com' || metadata.jwks_uri !== 'https://token.actions.githubusercontent.com/.well-known/jwks') {
    throw new Error('unexpected GitHub OIDC metadata');
  }
  const keyResponse = await fetchImpl(metadata.jwks_uri);
  if (!keyResponse.ok) throw new Error('GitHub OIDC signing keys unavailable');
  const claims = verifyGitHubActionsToken(oidcToken, await keyResponse.json(), { audience, now, expectedJobWorkflowPath });
  const base = 'https://api.github.com';
  const repository = await json(fetchImpl, `${base}/repos/${RELEASE_REPOSITORY}`, ghToken);
  if (repository.full_name?.toLowerCase() !== RELEASE_REPOSITORY.toLowerCase() || repository.id !== Number(claims.repository_id)) {
    throw new Error('signed repository identity does not match the canonical GitHub repository');
  }
  const workflow = await json(fetchImpl, `${base}/repos/${RELEASE_REPOSITORY}/actions/workflows/${COORDINATOR_WORKFLOW_PATH}`, ghToken);
  if (workflow.path !== COORDINATOR_WORKFLOW_PATH || workflow.state !== 'active' || !Number.isSafeInteger(workflow.id)) {
    throw new Error('trusted coordinator workflow is unavailable');
  }
  const run = await json(fetchImpl, `${base}/repos/${RELEASE_REPOSITORY}/actions/runs/${claims.run_id}`, ghToken);
  if (run.id !== Number(claims.run_id) || run.workflow_id !== workflow.id || !isPinnedCoordinatorRunPath(run.path) ||
      run.event !== claims.event_name || run.head_branch !== 'main' || run.head_sha !== claims.sha ||
      run.status !== 'in_progress' || run.run_attempt !== Number(claims.run_attempt)) {
    throw new Error('coordinator run does not match signed job identity');
  }
  const jobs = await json(fetchImpl, `${base}/repos/${RELEASE_REPOSITORY}/actions/runs/${claims.run_id}/attempts/${claims.run_attempt}/jobs?per_page=100`, ghToken);
  if (!Array.isArray(jobs.jobs)) throw new Error('coordinator job listing unreadable');
  const job = jobs.jobs.find((candidate) => candidate.id === Number(claims.check_run_id));
  if (!job || job.run_id !== run.id || job.name !== expectedJobName || job.status !== 'in_progress' || job.head_sha !== claims.sha ||
      !Array.isArray(job.labels) || !job.labels.includes(WORKER_RUNNER_LABEL) ||
      typeof job.runner_name !== 'string' || job.runner_name.length === 0) {
    throw new Error('signed OIDC check run is not the active worker job on the approved runner');
  }
  const ref = await json(fetchImpl, `${base}/repos/${RELEASE_REPOSITORY}/git/ref/heads/main`, ghToken);
  if (ref.object?.sha !== claims.sha) throw new Error('coordinator SHA is no longer current main');
  return { claims, run, job, jobs: jobs.jobs, currentSha: ref.object.sha };
}

export const authorizeCoordinatorWorker = (options) => authorizeCoordinatorJob(options);

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const mode = process.argv[2];
  const options = mode === 'worker'
    ? { expectedJobName: WORKER_JOB_NAME }
    : mode === 'publisher'
      ? { expectedJobName: 'Deploy to Vercel', expectedJobWorkflowPath: '.github/workflows/deploy.yml' }
      : null;
  if (!options) {
    process.stderr.write('expected worker or publisher authorization mode\n');
    process.exitCode = 64;
  } else {
    authorizeCoordinatorJob(options).then(({ claims }) => {
      process.stdout.write(`${claims.run_id}\t${claims.sha}\t${claims.run_attempt}\n`);
    }).catch((error) => {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
    });
  }
}
