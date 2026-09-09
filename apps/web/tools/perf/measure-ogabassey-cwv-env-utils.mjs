import { join } from 'node:path';

const WRAPPER_DEFAULT_ENV_KEYS = 'OGABASSEY_CWV_WRAPPER_DEFAULT_KEYS';

function getWrapperDefaultEnvKeys(env = process.env) {
  return new Set(
    `${env[WRAPPER_DEFAULT_ENV_KEYS] ?? ''}`
      .split(',')
      .map((key) => key.trim())
      .filter(Boolean)
  );
}

function rememberWrapperDefaultEnvKey(env, key) {
  const keys = getWrapperDefaultEnvKeys(env);
  keys.add(key);
  env[WRAPPER_DEFAULT_ENV_KEYS] = [...keys].sort().join(',');
}

function stripInlineEnvComment(rawValue) {
  let quote = null;
  for (let index = 0; index < rawValue.length; index += 1) {
    const char = rawValue[index];
    if (quote) {
      if (char === quote && rawValue[index - 1] !== '\\') {
        quote = null;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (char === '#') {
      return rawValue.slice(0, index).trimEnd();
    }
  }

  return rawValue.trimEnd();
}

function parseEnvValue(rawValue) {
  return stripInlineEnvComment(rawValue)
    .trim()
    .replace(/^(["'])(.*)\1$/, '$2');
}

async function loadEnvFile(
  path,
  { env = process.env, override = false, readText } = {}
) {
  const reader = readText ?? (await import('node:fs/promises')).readFile;
  let text = '';
  try {
    text = await reader(path, 'utf8');
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 'ENOENT'
    ) {
      return false;
    }
    throw error;
  }

  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const index = trimmed.indexOf('=');
    const key = trimmed.slice(0, index).trim();
    const raw = trimmed.slice(index + 1).trim();
    const shouldOverride =
      typeof override === 'function' ? override(key, env[key]) : override;
    if (!key || (!shouldOverride && env[key] !== undefined)) continue;
    env[key] = parseEnvValue(raw);
  }
  return true;
}

async function loadOgaBasseyCwvEnvFiles({
  appRoot,
  env = process.env,
  loadEnvFileImpl = loadEnvFile,
  repoRoot,
} = {}) {
  const wrapperDefaultEnvKeys = getWrapperDefaultEnvKeys(env);
  const envKeysBeforeAuditFileLoad = new Set(Object.keys(env));
  for (const key of wrapperDefaultEnvKeys) {
    envKeysBeforeAuditFileLoad.delete(key);
  }

  const rootEnvFile =
    env.OGABASSEY_CWV_ROOT_ENV_FILE || join(repoRoot, '.env.local');
  const appEnvFile =
    env.OGABASSEY_CWV_APP_ENV_FILE || join(appRoot, '.env.local');

  await loadEnvFileImpl(rootEnvFile, {
    env,
    override: (key) => wrapperDefaultEnvKeys.has(key),
  });
  await loadEnvFileImpl(appEnvFile, {
    env,
    override: (key) =>
      wrapperDefaultEnvKeys.has(key) || !envKeysBeforeAuditFileLoad.has(key),
  });

  return { appEnvFile, rootEnvFile };
}

function normalizeEnvFlag(value) {
  return `${value ?? ''}`.trim().toLowerCase();
}

function isTruthyEnvValue(value) {
  return ['1', 'true', 'yes', 'on'].includes(normalizeEnvFlag(value));
}

function isFalseyEnvValue(value) {
  return ['0', 'false', 'no', 'off'].includes(normalizeEnvFlag(value));
}

function setDefaultEnv(env, key, value, { track = false } = {}) {
  if (`${env[key] ?? ''}`.trim()) return;
  env[key] = value;
  if (track) {
    rememberWrapperDefaultEnvKey(env, key);
  }
}

export const ogabasseyCwvEnv = Object.freeze({
  WRAPPER_DEFAULT_ENV_KEYS,
  getWrapperDefaultEnvKeys,
  loadEnvFile,
  loadOgaBasseyCwvEnvFiles,
  normalizeEnvFlag,
  isTruthyEnvValue,
  isFalseyEnvValue,
  setDefaultEnv,
});
