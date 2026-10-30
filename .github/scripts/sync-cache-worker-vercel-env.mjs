#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { lstatSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const KEY = 'CACHE_INVALIDATION_WORKER_TOKEN';
const PROJECT_ID = 'prj_y6kGI7ZzyFWU6tyZbaklPtVsXeqx';
const TEAM_ID = 'team_P85yMqd79TPq8aSGSt2kojWY';
const ENV_FILE = '.vercel/.env.production.local';
const PROJECT_FILE = '.vercel/project.json';
const RUN_PINNED_VERCEL = fileURLToPath(new URL('./run-pinned-vercel.sh', import.meta.url));
const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const ALGORITHMS = new Set(['ES256', 'HS256', 'RS256']);

function fail(message) {
  throw new Error(message);
}

function parseJwtPart(token, index) {
  const part = token.split('.')[index];
  if (!part) fail('cache worker token is not a JWT');
  let value;
  try {
    value = JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
  } catch {
    fail('cache worker token is not a valid JWT');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail('cache worker token is not a valid JWT');
  }
  return value;
}

export function validateCacheWorkerToken(token, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (typeof token !== 'string' || token.length < 1 || token.length > 8192 || token.split('.').length !== 3) {
    fail('cache worker token is unavailable or malformed');
  }
  const header = parseJwtPart(token, 0);
  const claims = parseJwtPart(token, 1);
  if (!ALGORITHMS.has(header.alg) || claims.role !== 'cache_invalidation_worker' ||
      !Number.isSafeInteger(claims.exp) || claims.exp <= nowSeconds) {
    fail('cache worker token does not match the active restricted capability contract');
  }
}

export function hasSinglePulledProductionAssignment(contents) {
  const count = contents.split('\n').filter((line) => {
    const normalized = line.endsWith('\r') ? line.slice(0, -1) : line;
    return /^(?:export[ \t]+)?CACHE_INVALIDATION_WORKER_TOKEN[ \t]*=/.test(normalized);
  }).length;
  return count === 1;
}

function safeChildEnvironment(env) {
  const names = [
    'PATH', 'HOME', 'TMPDIR', 'RUNNER_TEMP', 'VERCEL_CLI_VERSION',
    'VERCEL_CLI_DIR', 'VERCEL_CLI_STORE', 'VERCEL_TOKEN',
    'VERCEL_PROJECT_ID', 'VERCEL_ORG_ID',
  ];
  return Object.fromEntries(names.filter((name) => typeof env[name] === 'string').map((name) => [name, env[name]]));
}

function defaultRunVercel(args, { env, input, token }) {
  const result = spawnSync('bash', [RUN_PINNED_VERCEL, ...args], {
    cwd: ROOT,
    env: safeChildEnvironment(env),
    input,
    encoding: 'utf8',
    maxBuffer: 5 * 1024 * 1024,
    timeout: 120_000,
  });
  const captured = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  if (captured.includes(token)) fail('Vercel CLI output reflected the cache worker token');
  if (result.error || result.status !== 0) fail('Vercel Production cache worker environment update failed');
}

export async function syncCacheWorkerVercelEnv({
  env = process.env,
  runVercel = defaultRunVercel,
  readProjectLink = () => {
    const metadata = lstatSync(`${ROOT}/${PROJECT_FILE}`);
    if (!metadata.isFile() || metadata.isSymbolicLink() || (metadata.mode & 0o077) !== 0) {
      fail('Vercel project link file has unsafe permissions or type');
    }
    return readFileSync(`${ROOT}/${PROJECT_FILE}`, 'utf8');
  },
  readEnvFile = () => {
    const metadata = lstatSync(`${ROOT}/${ENV_FILE}`);
    if (!metadata.isFile() || metadata.isSymbolicLink() || (metadata.mode & 0o077) !== 0) {
      fail('pulled Vercel Production environment file has unsafe permissions or type');
    }
    return readFileSync(`${ROOT}/${ENV_FILE}`, 'utf8');
  },
} = {}) {
  const token = env.CACHE_INVALIDATION_WORKER_TOKEN;
  validateCacheWorkerToken(token);
  if (env.VERCEL_PROJECT_ID !== PROJECT_ID || env.VERCEL_ORG_ID !== TEAM_ID ||
      typeof env.VERCEL_TOKEN !== 'string' || env.VERCEL_TOKEN.length === 0) {
    fail('canonical Vercel Production project access is unavailable');
  }

  // Link explicitly to the pinned project/team, then verify the resulting
  // project identity before any environment mutation. Update only the named
  // Production variable from stdin, then pull again to prove the sensitive
  // key exists in the canonical project. CLI output is captured and discarded.
  runVercel(['link', '--yes', `--project=${PROJECT_ID}`, `--scope=${TEAM_ID}`], { env, input: undefined, token });
  runVercel(['pull', '--yes', '--environment=production'], { env, input: undefined, token });
  let projectLink;
  try {
    projectLink = JSON.parse(readProjectLink());
  } catch {
    fail('Vercel project link could not be verified');
  }
  if (projectLink.projectId !== PROJECT_ID || projectLink.orgId !== TEAM_ID) {
    fail('Vercel link does not match the canonical Production project and team');
  }
  runVercel(['env', 'add', KEY, 'production', '--sensitive', '--force', '--yes'], {
    env,
    input: token,
    token,
  });
  runVercel(['pull', '--yes', '--environment=production'], { env, input: undefined, token });
  if (!hasSinglePulledProductionAssignment(readEnvFile())) {
    fail('Vercel Production cache worker token is absent or ambiguous after synchronization');
  }
  return { key: KEY, target: 'production', registered: true, presenceVerified: true };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  syncCacheWorkerVercelEnv().then(() => {
    process.stdout.write('Vercel Production cache worker token registration completed; key presence verified (value equality is not observable for sensitive variables).\n');
  }).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
