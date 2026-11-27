const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_OTA_UPDATES_URL =
  'https://u.expo.dev/c6c1897b-cac8-49b0-85f9-3d277aecc379';
const SELF_HOSTED_OTA_UPDATES_URL = 'https://ota.ogabassey.com/api/manifest';
const SELF_HOSTED_OTA_UPDATES_URLS = new Set([
  SELF_HOSTED_OTA_UPDATES_URL,
  'https://ota.usebaci.com/api/manifest',
]);
const ALLOWED_OTA_UPDATES_URLS = new Set([
  DEFAULT_OTA_UPDATES_URL,
  ...SELF_HOSTED_OTA_UPDATES_URLS,
]);

function isNonPublicIpHost(host) {
  if (host.includes(':')) {
    return true;
  }
  const ipv4Parts = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!ipv4Parts) {
    return false;
  }
  const octets = ipv4Parts.slice(1).map((n) => Number(n));
  const [a, b] = octets;
  const validOctets = octets.every((o) => o >= 0 && o <= 255);
  return (
    !validOctets ||
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224
  );
}

function resolveOtaUpdatesUrl(rawUrl) {
  const rawUpdatesUrl = rawUrl?.trim();
  if (!rawUpdatesUrl) {
    return DEFAULT_OTA_UPDATES_URL;
  }
  let parsedUpdatesUrl;
  try {
    parsedUpdatesUrl = new URL(rawUpdatesUrl);
  } catch {
    throw new Error(
      `[app.config] Invalid EXPO_PUBLIC_OTA_UPDATES_URL="${rawUpdatesUrl}". Must be a valid https URL.`
    );
  }
  if (parsedUpdatesUrl.protocol !== 'https:') {
    throw new Error(
      `[app.config] Invalid EXPO_PUBLIC_OTA_UPDATES_URL="${rawUpdatesUrl}". Must use https.`
    );
  }
  const host = parsedUpdatesUrl.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (
    parsedUpdatesUrl.username ||
    parsedUpdatesUrl.password ||
    parsedUpdatesUrl.hash ||
    parsedUpdatesUrl.search ||
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    isNonPublicIpHost(host)
  ) {
    throw new Error(
      `[app.config] Invalid EXPO_PUBLIC_OTA_UPDATES_URL="${rawUpdatesUrl}". Must be a public https origin/path without credentials, query, fragment, or non-public/loopback host.`
    );
  }
  if (!ALLOWED_OTA_UPDATES_URLS.has(parsedUpdatesUrl.href)) {
    throw new Error(
      `[app.config] Invalid EXPO_PUBLIC_OTA_UPDATES_URL="${rawUpdatesUrl}". Must be an allowlisted OTA endpoint (${[...ALLOWED_OTA_UPDATES_URLS].join(', ')}).`
    );
  }
  return parsedUpdatesUrl.href;
}

function resolveCodeSigningCertificatePath(env, appRootDir) {
  const certPath =
    env.EXPO_PUBLIC_OTA_CODE_SIGNING_CERTIFICATE_PATH?.trim() ||
    env.EXPO_OTA_CODE_SIGNING_CERTIFICATE_PATH?.trim() ||
    undefined;
  if (!certPath) {
    return undefined;
  }
  if (certPath.includes('-----BEGIN') || /[\r\n]/.test(certPath)) {
    throw new Error(
      '[app.config] EXPO_PUBLIC_OTA_CODE_SIGNING_CERTIFICATE_PATH must be a file path to a PEM certificate, not inline PEM contents.'
    );
  }
  if (
    path.isAbsolute(certPath) ||
    certPath.split(/[/\\]/).includes('..') ||
    !/\.(pem|crt|cer)$/i.test(certPath)
  ) {
    throw new Error(
      `[app.config] Invalid EXPO_PUBLIC_OTA_CODE_SIGNING_CERTIFICATE_PATH="${certPath}". Expected a relative .pem/.crt/.cer path.`
    );
  }
  if (env.EAS_BUILD === 'true') {
    const resolvedCertPath = path.resolve(appRootDir, certPath);
    if (!fs.existsSync(resolvedCertPath)) {
      throw new Error(
        `[app.config] EXPO_PUBLIC_OTA_CODE_SIGNING_CERTIFICATE_PATH="${certPath}" does not exist on disk.`
      );
    }
  }
  return certPath;
}

function buildStorefrontOtaUpdatesConfiguration(
  env,
  { updateChannel, appRootDir = path.resolve(__dirname, '..') }
) {
  const updatesUrl = resolveOtaUpdatesUrl(env.EXPO_PUBLIC_OTA_UPDATES_URL);
  const codeSigningCertificatePath = resolveCodeSigningCertificatePath(
    env,
    appRootDir
  );
  const codeSigningKeyId =
    env.EXPO_PUBLIC_OTA_CODE_SIGNING_KEY_ID?.trim() ||
    env.EXPO_OTA_CODE_SIGNING_KEY_ID?.trim() ||
    'main';
  const allowUnsignedSelfHostedOta =
    env.EXPO_PUBLIC_OTA_ALLOW_UNSIGNED === 'true';

  if (
    codeSigningCertificatePath &&
    !SELF_HOSTED_OTA_UPDATES_URLS.has(updatesUrl)
  ) {
    throw new Error(
      `[app.config] EXPO_PUBLIC_OTA_CODE_SIGNING_CERTIFICATE_PATH requires EXPO_PUBLIC_OTA_UPDATES_URL="${SELF_HOSTED_OTA_UPDATES_URL}".`
    );
  }
  if (
    SELF_HOSTED_OTA_UPDATES_URLS.has(updatesUrl) &&
    !codeSigningCertificatePath &&
    !allowUnsignedSelfHostedOta
  ) {
    throw new Error(
      `[app.config] Self-hosted OTA URL "${updatesUrl}" requires EXPO_PUBLIC_OTA_CODE_SIGNING_CERTIFICATE_PATH unless EXPO_PUBLIC_OTA_ALLOW_UNSIGNED=true is explicitly set.`
    );
  }

  return {
    url: updatesUrl,
    checkAutomatically: 'ON_LOAD',
    fallbackToCacheTimeout: 0,
    requestHeaders: {
      'expo-channel-name': updateChannel,
    },
    ...(codeSigningCertificatePath
      ? {
          codeSigningCertificate: codeSigningCertificatePath,
          codeSigningMetadata: {
            alg: 'rsa-v1_5-sha256',
            keyid: codeSigningKeyId,
          },
        }
      : {}),
  };
}

module.exports = { buildStorefrontOtaUpdatesConfiguration };
