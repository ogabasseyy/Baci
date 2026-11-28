const VALUE_FLAGS = {
  '--dist': 'distDir',
  '--config': 'configPath',
  '--platform': 'platform',
  '--runtime': 'runtimeVersion',
  '--channel': 'channel',
  '--source-sha': 'sourceSha',
  '--update-id': 'updateId',
  '--expected-current-update-id': 'expectedCurrentUpdateId',
  '--idempotency-key': 'idempotencyKey',
  '--server': 'serverUrl',
  '--token': 'token',
};

const BOOLEAN_FLAGS = new Set(['--rollback', '--to-embedded', '--dry-run']);
const CHANNEL_REGEX = /^[a-zA-Z0-9._-]{1,64}$/;
const RUNTIME_REGEX = /^[a-zA-Z0-9._+-]{1,128}$/;
const IDEMPOTENCY_KEY_REGEX = /^[a-zA-Z0-9._:-]{8,128}$/;
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COMMIT_SHA_REGEX = /^[0-9a-f]{40}$/i;

export function normalizeServerBaseUrl(serverUrl) {
  let parsed;
  try {
    parsed = new URL(serverUrl.trim());
  } catch {
    throw new Error(`Invalid OTA server URL: ${serverUrl}`);
  }
  if (parsed.protocol !== 'https:') {
    throw new Error('OTA server URL must use https://');
  }
  const normalizedPath = parsed.pathname
    .replace(/\/+$/, '')
    .replace(/\/api\/manifest$/, '');
  if (normalizedPath !== '') {
    throw new Error(
      `OTA server URL must target the root origin without a path prefix: ${serverUrl}`
    );
  }
  return parsed.origin;
}

export function parseCliArgs(argv) {
  const options = {
    channel: 'production',
    dryRun: false,
    rollback: false,
    toEmbedded: false,
    serverUrl: process.env.OTA_SERVER_URL || 'https://ota.ogabassey.com',
    token: process.env.OTA_ADMIN_TOKEN || '',
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg in VALUE_FLAGS) {
      const value = argv[i + 1];
      if (
        value === undefined ||
        value.trim().length === 0 ||
        value in VALUE_FLAGS ||
        BOOLEAN_FLAGS.has(value)
      ) {
        throw new Error(`Missing or invalid value for ${arg}`);
      }
      options[VALUE_FLAGS[arg]] = value;
      i += 1;
    } else if (arg === '--rollback') {
      options.rollback = true;
    } else if (arg === '--to-embedded') {
      options.toEmbedded = true;
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else {
      throw new Error(`Unknown CLI argument: ${arg}`);
    }
  }

  if (options.platform !== 'ios' && options.platform !== 'android') {
    throw new Error('--platform must be "ios" or "android"');
  }
  if (
    !options.runtimeVersion?.trim() ||
    options.runtimeVersion.includes('..') ||
    !RUNTIME_REGEX.test(options.runtimeVersion.trim())
  ) {
    throw new Error('--runtime is required and must be a valid runtime version');
  }
  if (
    !options.channel?.trim() ||
    options.channel.includes('..') ||
    !CHANNEL_REGEX.test(options.channel.trim())
  ) {
    throw new Error('--channel must be a valid channel name');
  }
  if (options.updateId !== undefined && !UUID_REGEX.test(options.updateId.trim())) {
    throw new Error('--update-id must be a valid UUID');
  }
  if (
    options.expectedCurrentUpdateId !== undefined &&
    !UUID_REGEX.test(options.expectedCurrentUpdateId.trim())
  ) {
    throw new Error('--expected-current-update-id must be a valid UUID');
  }
  if (options.expectedCurrentUpdateId !== undefined && !options.rollback) {
    throw new Error('--expected-current-update-id requires --rollback');
  }
  if (
    options.idempotencyKey !== undefined &&
    !IDEMPOTENCY_KEY_REGEX.test(options.idempotencyKey.trim())
  ) {
    throw new Error('--idempotency-key must match [a-zA-Z0-9._:-]{8,128}');
  }
  if (
    options.sourceSha !== undefined &&
    !COMMIT_SHA_REGEX.test(options.sourceSha.trim())
  ) {
    throw new Error('--source-sha must be a 40-char hex SHA');
  }
  if (options.toEmbedded && !options.rollback) {
    throw new Error('--to-embedded requires --rollback');
  }
  if (options.rollback && options.toEmbedded && options.updateId) {
    throw new Error('Specify either --update-id or --to-embedded, not both');
  }
  if (
    options.rollback &&
    !options.toEmbedded &&
    !options.updateId &&
    !options.idempotencyKey?.trim()
  ) {
    throw new Error(
      '--idempotency-key is required for targetless --rollback (without --update-id or --to-embedded)'
    );
  }
  if (!options.rollback && !options.distDir?.trim()) {
    throw new Error('--dist is required when publishing');
  }
  if (!options.dryRun && !options.token?.trim()) {
    throw new Error('OTA_ADMIN_TOKEN or --token is required');
  }
  return options;
}
