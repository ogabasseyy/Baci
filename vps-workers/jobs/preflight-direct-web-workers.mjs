import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parse } from 'dotenv';

const REQUIRED_ENV = [
  'BACI_REPO_DIR',
  'BACI_WEB_BASE_URL',
  'INTERNAL_API_SECRET',
  'IMEI_IDENTIFIER_ENCRYPTION_KEY',
  'JUMIA_AUTHORIZATION_ENCRYPTION_KEY',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'NEXT_PUBLIC_SUPABASE_URL',
  'PETROCK_API_TOKEN',
  'PETROCK_ENABLED',
  'PETROCK_ENABLED_TIERS',
  'PETROCK_REMEDIATION_ENABLED',
  'QUIZ_PHASE',
  'QUIZ_PRODUCTION_APPROVED',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_JUMIA_CREDENTIAL_KEY',
  'ZEPTOMAIL_TOKEN',
];
const GIGL_REQUIRED_ENV = [
  'GIGL_BASE_URL',
  'GIGL_EMAIL',
  'GIGL_PASSWORD',
  'GIGL_TRACKING_WORKER_TOKEN',
];
const ENV_BOOLEAN_VALUES = new Set(['0', '1', 'false', 'no', 'true', 'yes']);
const DISABLED_GIGL_VALUES = new Set(['0', 'false', 'off']);
const SUPPORTED_GIGL_TOKEN_ALGORITHMS = new Set(['ES256', 'HS256']);

function isConfigured(env, name) {
  return typeof env[name] === 'string' && env[name].trim().length > 0;
}

function isCredentialFreeHttpsUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
}

function isGiglExplicitlyDisabled(env) {
  return DISABLED_GIGL_VALUES.has(env.GIGL_ENABLED?.trim().toLowerCase() ?? '');
}

function parseJwtPart(token, index) {
  const value = token.split('.')[index];
  if (!value) throw new Error('JWT part is missing');
  const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('JWT part is invalid');
  }
  return parsed;
}

function isRestrictedGiglWorkerToken(value, now = Date.now()) {
  try {
    if (value.split('.').length !== 3) return false;
    const header = parseJwtPart(value, 0);
    const claims = parseJwtPart(value, 1);
    return (
      SUPPORTED_GIGL_TOKEN_ALGORITHMS.has(header.alg) &&
      claims.role === 'gigl_tracking_worker' &&
      typeof claims.exp === 'number' &&
      claims.exp * 1000 > now + 24 * 60 * 60 * 1000
    );
  } catch {
    return false;
  }
}

// dotenv accepts multiline quoted values, but the shell reader
// (gigl-dotenv.sh) is line-oriented: it would hand the poller the
// first line while dotenv-based checks validated the whole value (or
// a spanning value swallowing later assignments). The keys below are
// exactly the ones the shell boundary reads (the filter allowlist
// plus the latch/fallback identity keys); an unterminated quote on
// any of their lines fails the preflight loudly instead of diverging
// silently. Other workers may keep multiline values.
const SHELL_READ_KEYS = new Set([
  'BACI_REPO_DIR',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'NEXT_PUBLIC_SUPABASE_URL',
]);

function isShellReadKey(name) {
  return SHELL_READ_KEYS.has(name) || name.startsWith('GIGL_');
}

export function findMultilineDotenvAssignments(text) {
  const offenders = [];
  for (const [index, line] of text.split('\n').entries()) {
    const match = line.match(
      /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(['"`])/
    );
    if (match === null || !isShellReadKey(match[1])) {
      continue;
    }
    const quote = match[2];
    let escaped = false;
    let closed = false;
    for (const char of line.slice(match[0].length)) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === quote) {
        closed = true;
        break;
      }
    }
    if (!closed) {
      offenders.push(`${match[1]} (line ${index + 1})`);
    }
  }
  return offenders;
}

function isBase64Encoded32ByteKey(value) {
  const normalized = value.trim();
  if (
    normalized.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(normalized)
  ) {
    return false;
  }

  try {
    const decoded = Buffer.from(normalized, 'base64');
    return decoded.length === 32 && decoded.toString('base64') === normalized;
  } catch {
    return false;
  }
}

export function getDirectWorkerPreflightProblems(env) {
  const problems = [];
  for (const name of REQUIRED_ENV) {
    if (!isConfigured(env, name)) {
      problems.push(`${name} is required`);
    }
  }

  const isGiglDisabled = isGiglExplicitlyDisabled(env);
  if (!isGiglDisabled) {
    for (const name of GIGL_REQUIRED_ENV) {
      if (!isConfigured(env, name)) {
        problems.push(`${name} is required`);
      }
    }
  }

  if (
    isConfigured(env, 'JUMIA_AUTHORIZATION_ENCRYPTION_KEY') &&
    !isBase64Encoded32ByteKey(env.JUMIA_AUTHORIZATION_ENCRYPTION_KEY)
  ) {
    problems.push(
      'JUMIA_AUTHORIZATION_ENCRYPTION_KEY must be Base64-encoded 32 bytes'
    );
  }

  if (
    isConfigured(env, 'BACI_WEB_BASE_URL') &&
    !isCredentialFreeHttpsUrl(env.BACI_WEB_BASE_URL)
  ) {
    problems.push('BACI_WEB_BASE_URL must be credential-free HTTPS');
  }
  if (
    !isGiglDisabled &&
    isConfigured(env, 'GIGL_BASE_URL') &&
    !isCredentialFreeHttpsUrl(env.GIGL_BASE_URL)
  ) {
    problems.push('GIGL_BASE_URL must be credential-free HTTPS');
  }
  if (
    !isGiglDisabled &&
    isConfigured(env, 'GIGL_TRACKING_WORKER_TOKEN') &&
    !isRestrictedGiglWorkerToken(env.GIGL_TRACKING_WORKER_TOKEN)
  ) {
    problems.push(
      'GIGL_TRACKING_WORKER_TOKEN must be a current restricted worker token'
    );
  }

  for (const name of [
    'PETROCK_ENABLED',
    'PETROCK_REMEDIATION_ENABLED',
    'QUIZ_PRODUCTION_APPROVED',
  ]) {
    if (
      isConfigured(env, name) &&
      !ENV_BOOLEAN_VALUES.has(env[name].trim().toLowerCase())
    ) {
      problems.push(`${name} must be an explicit boolean`);
    }
  }

  const quizPhase = env.QUIZ_PHASE?.trim();
  if (
    isConfigured(env, 'QUIZ_PHASE') &&
    quizPhase !== '1a' &&
    quizPhase !== 'production'
  ) {
    problems.push('QUIZ_PHASE must be 1a or production');
  }
  if (quizPhase === 'production') {
    if (!isConfigured(env, 'QUIZ_RPC_SERVER_SECRET')) {
      problems.push('QUIZ_RPC_SERVER_SECRET is required for production');
    }
    if (!isConfigured(env, 'QUIZ_DEVICE_HASH_PEPPER')) {
      problems.push('QUIZ_DEVICE_HASH_PEPPER is required for production');
    } else if (env.QUIZ_DEVICE_HASH_PEPPER.trim().length < 32) {
      problems.push('QUIZ_DEVICE_HASH_PEPPER must be at least 32 characters');
    }
  }

  return problems;
}

function runDirectWorkerPreflight({
  env = process.env,
  rawText = '',
  logger = console,
} = {}) {
  const problems = getDirectWorkerPreflightProblems(env);
  for (const offender of findMultilineDotenvAssignments(rawText)) {
    problems.push(
      `${offender} has an unterminated quoted value: use a single line with \\n escapes`
    );
  }
  if (problems.length > 0) {
    logger.error(`[direct-worker-preflight] ${problems.join(', ')}`);
    return 1;
  }

  logger.log(
    '[direct-worker-preflight] direct worker environment is configured'
  );
  return 0;
}

function main() {
  // File-authoritative: validate the staged dotenv as parsed, ignoring
  // inherited process state. dotenv's default non-overriding load would
  // let a runner/SSH-exported GIGL_ENABLED=off (or a caller-provided
  // provider value) satisfy checks that cron reads from the file.
  // BACI_WORKER_ENV overrides the default staged path (tests;
  // production callers rely on the fixed staging location).
  const dotenvPath =
    process.env.BACI_WORKER_ENV ||
    fileURLToPath(new URL('../.env', import.meta.url));
  let rawText = '';
  let parsed = {};
  try {
    rawText = readFileSync(dotenvPath, 'utf8');
    parsed = parse(rawText);
  } catch {
    // Missing/unreadable file: every required check fails below.
  }
  process.exitCode = runDirectWorkerPreflight({ env: parsed, rawText });
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main();
}
