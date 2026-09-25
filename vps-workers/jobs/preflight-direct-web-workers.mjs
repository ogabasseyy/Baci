import { fileURLToPath, pathToFileURL } from 'node:url';
import { config } from 'dotenv';

const REQUIRED_ENV = [
  'BACI_REPO_DIR',
  'BACI_WEB_BASE_URL',
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
const ENV_BOOLEAN_VALUES = new Set(['0', '1', 'false', 'no', 'true', 'yes']);

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
  logger = console,
} = {}) {
  const problems = getDirectWorkerPreflightProblems(env);
  if (problems.length > 0) {
    logger.error(`[direct-worker-preflight] ${problems.join(', ')}`);
    return 1;
  }

  logger.log(
    '[direct-worker-preflight] Petrock and quiz environment is configured'
  );
  return 0;
}

function main() {
  config({ path: fileURLToPath(new URL('../.env', import.meta.url)) });
  process.exitCode = runDirectWorkerPreflight();
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main();
}
