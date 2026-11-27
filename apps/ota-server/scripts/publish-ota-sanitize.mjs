import { createHash } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import path from 'node:path';

export async function readContainedFile(baseDir, relativePath) {
  if (typeof relativePath !== 'string' || path.isAbsolute(relativePath)) {
    throw new Error(`Invalid relative export path: ${String(relativePath)}`);
  }
  const canonicalRoot = await realpath(baseDir);
  const resolved = path.resolve(canonicalRoot, relativePath);
  if (!resolved.startsWith(`${canonicalRoot}${path.sep}`)) {
    throw new Error(`Export path escapes dist directory: ${relativePath}`);
  }
  const stat = await lstat(resolved);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`Export file must be a regular file: ${relativePath}`);
  }
  const canonicalTarget = await realpath(resolved);
  if (!canonicalTarget.startsWith(`${canonicalRoot}${path.sep}`)) {
    throw new Error(`Export path escapes canonical dist root: ${relativePath}`);
  }
  const handle = await open(
    canonicalTarget,
    fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0)
  );
  try {
    const fdStat = await handle.stat();
    if (!fdStat.isFile()) {
      throw new Error(`Export file must be a regular file: ${relativePath}`);
    }
    return await handle.readFile();
  } finally {
    await handle.close();
  }
}

export function hashBytes(bytes) {
  const digest = createHash('sha256').update(bytes).digest();
  return {
    sha256Hex: digest.toString('hex'),
    sha256Base64Url: digest.toString('base64url'),
  };
}

const CONTENT_TYPES = {
  css: 'text/css',
  db: 'application/octet-stream',
  gif: 'image/gif',
  hbc: 'application/javascript',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  js: 'application/javascript',
  json: 'application/json',
  mp3: 'audio/mpeg',
  mp4: 'video/mp4',
  otf: 'font/otf',
  pdf: 'application/pdf',
  png: 'image/png',
  ttf: 'font/ttf',
  wav: 'audio/wav',
  webp: 'image/webp',
  woff: 'font/woff',
  woff2: 'font/woff2',
};

export function inferAssetContentType(ext) {
  const normalized = (ext ?? '').replace(/^\./, '').toLowerCase();
  return CONTENT_TYPES[normalized] ?? 'application/octet-stream';
}

const EXPO_CLIENT_ALLOWLIST = {
  name: true,
  slug: true,
  version: true,
  runtimeVersion: true,
  sdkVersion: true,
  platforms: true,
  owner: true,
  scheme: true,
  orientation: true,
  userInterfaceStyle: true,
  updates: {
    enabled: true,
    checkAutomatically: true,
    fallbackToCacheTimeout: true,
    url: true,
    requestHeaders: {
      'expo-channel-name': true,
    },
    codeSigningCertificate: true,
    codeSigningMetadata: {
      alg: true,
      keyid: true,
    },
  },
  ios: {
    bundleIdentifier: true,
    buildNumber: true,
    runtimeVersion: true,
    supportsTablet: true,
    usesAppleSignIn: true,
  },
  android: {
    package: true,
    versionCode: true,
    runtimeVersion: true,
  },
  extra: {
    merchantId: true,
    merchantSlug: true,
    merchantDomain: true,
    businessType: true,
    templateId: true,
    supabaseUrl: true,
    supabasePublishableKey: true,
    supabaseAnonKey: true,
    apiUrl: true,
    posthogApiKey: true,
    posthogHost: true,
    tiktokBusiness: {
      iosAppStoreId: true,
      iosTikTokAppId: true,
      isConfigured: true,
    },
    facebookAppId: true,
    eas: {
      projectId: true,
    },
  },
};

function sanitizeAllowedValue(value, schema) {
  if (typeof value === 'string') {
    if (value.includes('-----BEGIN') && value.includes('PRIVATE KEY')) {
      throw new Error(
        'Refusing to embed private key material in expoClient manifest metadata'
      );
    }
    return value;
  }
  if (schema === true) {
    if (Array.isArray(value)) {
      return value.map((item) => sanitizeAllowedValue(item, true));
    }
    if (value && typeof value === 'object') {
      return undefined;
    }
    return value;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  const out = {};
  for (const [key, childSchema] of Object.entries(schema)) {
    if (!Object.hasOwn(value, key) || value[key] === undefined) {
      continue;
    }
    const sanitized = sanitizeAllowedValue(value[key], childSchema);
    if (sanitized !== undefined) {
      out[key] = sanitized;
    }
  }
  return out;
}

export function sanitizeExpoClientForManifest(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return undefined;
  }
  return sanitizeAllowedValue(raw, EXPO_CLIENT_ALLOWLIST);
}
