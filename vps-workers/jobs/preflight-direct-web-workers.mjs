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
  // Grounded in dotenv itself, not a hand-rolled quote scan and not
  // the parsed value's bytes: `"a\nb"` parses to an embedded LF yet
  // is one physical line the shell reads exactly, so byte-sniffing
  // the value false-positives. Instead, compare dotenv's full-file
  // value for each shell-read key against dotenv's parse of the key's
  // last shell-effective physical line (mirroring gigl-dotenv.sh's
  // line matching and last-wins, after its CR truncation): equal
  // means the line-oriented reader sees what the preflight validated
  // — given reader parity — while any difference means the value
  // genuinely spans lines (or is shadowed by a span) and the shell
  // would hand the poller different bytes. A span swallowing a
  // shell-read key's line removes the key from the full parse; that
  // stays silent here and surfaces as a missing key in the
  // required-value check instead. Separators also span: dotenv
  // accepts whitespace across `=`/`:` (`KEY:` or a bare `KEY` line
  // followed by the value), which no physical line assigns in shell
  // form — the shell reader then misses a key the required check
  // passes, so keys dotenv parsed without any shell-effective line
  // are offenders too (blank values excepted: shell-empty and
  // dotenv-empty agree, and the required check reports them missing).
  const full = parse(text);
  const lines = text.split('\n');
  const lastLineByKey = new Map();
  for (const [index, rawLine] of lines.entries()) {
    const line = rawLine.replace(/\r.*$/, '');
    const match = line.match(
      /^[ \t]*(?:export[ \t]+)?([A-Za-z_][A-Za-z0-9_]*)(?::[ \t]|[ \t]*=)/
    );
    if (match === null || !isShellReadKey(match[1])) {
      continue;
    }
    lastLineByKey.set(match[1], { index, line });
  }
  const offenders = [];
  for (const [key, { index, line }] of lastLineByKey) {
    if (!(key in full)) {
      continue;
    }
    const single = parse(line);
    if (!(key in single) || single[key] !== full[key]) {
      offenders.push(`${key} (line ${index + 1})`);
    }
  }
  for (const key of Object.keys(full)) {
    // The shell boundary only ever addresses identifier keys (the
    // scoped-env enumerator matches GIGL_[A-Za-z0-9_]*); dotenv's
    // dotted/dashed keys are unreadable there, so they cannot diverge.
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      continue;
    }
    if (!isShellReadKey(key) || lastLineByKey.has(key)) {
      continue;
    }
    if ((full[key] ?? '').trim() === '') {
      continue;
    }
    const blame = lastKeyMentionIndex(lines, key);
    offenders.push(blame >= 0 ? `${key} (line ${blame + 1})` : key);
  }
  return offenders;
}

function lastKeyMentionIndex(lines, key) {
  // Locate dotenv's match for blame: unlike the shell matcher above,
  // dotenv's line anchor and export prefix accept any whitespace.
  for (let index = lines.length - 1; index >= 0; index--) {
    const text = lines[index]
      .replace(/\r.*$/, '')
      .replace(/^\s*/, '')
      .replace(/^export\s+/, '');
    if (
      text === key ||
      (text.startsWith(key) && !/[\w.-]/.test(text[key.length] ?? ''))
    ) {
      return index;
    }
  }
  return -1;
}

// dotenv expands `\n` inside double quotes, but the shell boundary
// captures values through command substitution, which strips trailing
// line feeds: `GIGL_PASSWORD="abc\n"` validates as four bytes while
// cron exports three. Only a TRAILING line feed diverges (a mid-value
// escape survives capture on both sides), so reject exactly that:
// shell-read keys whose parsed value ends with `\n`. Unterminated
// (true multiline) values are rejected above; this catches the
// single-line escape the quote check accepts.
export function findTrailingNewlineValues(env) {
  const offenders = [];
  for (const name of Object.keys(env)) {
    if (!isShellReadKey(name)) {
      continue;
    }
    if ((env[name] ?? '').endsWith('\n')) {
      offenders.push(name);
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
  for (const offender of findTrailingNewlineValues(env)) {
    problems.push(
      `${offender} must not end with a newline escape: the shell boundary strips trailing line feeds`
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
