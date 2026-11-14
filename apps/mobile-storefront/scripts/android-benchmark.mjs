#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { chmodSync, closeSync, existsSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAndroidBenchmarkGradleInit } from './android-benchmark-gradle.mjs';
import { resolveBenchmarkIdentity } from './android-benchmark-identity.mjs';
import { validateBenchmarkApk } from './android-benchmark-native-check.mjs';
import { redactPrivateValuesAndLimit } from './android-benchmark-redaction.mjs';

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const required = ['STOREFRONT_FACEBOOK_APP_ID', 'STOREFRONT_FACEBOOK_CLIENT_TOKEN', 'EXPO_PUBLIC_POSTHOG_API_KEY', 'EXPO_PUBLIC_SENTRY_DSN', 'SENTRY_ORG', 'SENTRY_PROJECT', 'SENTRY_AUTH_TOKEN', 'EXPO_PUBLIC_SUPABASE_URL'];
const optional = [
  'EXPO_PUBLIC_SUPABASE_ANON_KEY', 'EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  'EXPO_PUBLIC_STARTUP_DIAGNOSTIC_ID',
  'EXPO_PUBLIC_API_URL', 'EXPO_PUBLIC_WEB_API_URL', 'EXPO_PUBLIC_MERCHANT_DOMAIN',
  'EXPO_PUBLIC_GOOGLE_MAPS_API_KEY', 'EXPO_PUBLIC_POSTHOG_HOST', 'EXPO_PUBLIC_SENTRY_ENVIRONMENT',
  'SENTRY_URL', 'STOREFRONT_TIKTOK_APP_ID', 'STOREFRONT_TIKTOK_APP_STORE_ID', 'STOREFRONT_TIKTOK_APP_SECRET',
  'STOREFRONT_ADMOB_ANDROID_APP_ID', 'STOREFRONT_ADMOB_IOS_APP_ID', 'EXPO_PUBLIC_MOBILE_ADS_ENABLED', 'EXPO_PUBLIC_QUIZ_ADS_ENABLED',
  ...['ANDROID', 'IOS'].flatMap((platform) => [
    ...['BANNER', 'INTERSTITIAL', 'REWARDED'].map((kind) => `EXPO_PUBLIC_QUIZ_ADMOB_${platform}_${kind}_UNIT_ID`),
    ...['QUIZ_START_INTERSTITIAL', 'HOME_STRIP', 'PRODUCT_GRID_IN_FEED', 'PRODUCT_GRID_MPU', 'CART_MPU', 'ORDER_SUCCESS_BANNER', 'FOOTER_ANCHOR', 'POST_ORDER_INTERSTITIAL'].map((kind) => `EXPO_PUBLIC_ADMOB_${platform}_${kind}_UNIT_ID`),
  ]),
];
const allowed = [...required, ...optional];
const args = process.argv.slice(2);
let file = join(homedir(), '.config/baci/mobile-storefront-build.json');
let check = false;
let useInstalledDebugPackage = false;
let argumentError = false;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--check') check = true;
  else if (args[i] === '--use-installed-debug-package') useInstalledDebugPackage = true;
  else if (args[i] === '--env-file' && args[i + 1]) file = args[++i];
  else argumentError = true;
}
const errors = [];
if (argumentError || !isAbsolute(file)) errors.push('Use --check, --use-installed-debug-package, and optionally --env-file with an absolute path.');
let parsed = {};
if (!argumentError && isAbsolute(file) && existsSync(file)) {
  try {
    const stat = lstatSync(file);
    if (!stat.isFile()) errors.push('Configuration must be a regular file, not a symlink.');
    else if (process.platform !== 'win32' && (stat.mode & 0o077) !== 0) errors.push('Configuration file permissions must deny group and world access (chmod 600).');
    else {
      const content = readFileSync(file, 'utf8');
      parsed = content.trimStart().startsWith('{') ? JSON.parse(content) : require('dotenv').parse(content);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
      const invalid = Object.entries(parsed).filter(([, value]) => typeof value !== 'string').map(([key]) => allowed.includes(key) ? key : '(unrecognized key)');
      if (invalid.length) errors.push(`Configuration values must be strings: ${invalid.join(', ')}.`);
    }
  } catch {
    errors.push('Configuration could not be read or parsed.');
    parsed = {};
  }
}
const config = {};
for (const key of allowed) {
  const value = process.env[key] ?? parsed[key];
  if (typeof value === 'string' && value.trim()) config[key] = value.trim();
}
if (config.EXPO_PUBLIC_STARTUP_DIAGNOSTIC_ID && !/^[a-zA-Z0-9_-]{1,80}$/.test(config.EXPO_PUBLIC_STARTUP_DIAGNOSTIC_ID)) errors.push('EXPO_PUBLIC_STARTUP_DIAGNOSTIC_ID must contain only letters, digits, underscores or hyphens (max 80).');
const missing = required.filter((key) => !config[key]);
if (!config.EXPO_PUBLIC_SUPABASE_ANON_KEY && !config.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY) missing.push('EXPO_PUBLIC_SUPABASE_ANON_KEY or EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY');
if (missing.length) errors.push(`Missing required configuration: ${missing.join(', ')}.`);
if (existsSync(join(appDir, '.env'))) errors.push('Use a checkout without a local .env: app.config loads it outside the benchmark allowlist.');
if (errors.length) {
  console.error(`Android benchmark preflight failed:\n- ${errors.join('\n- ')}`);
  process.exit(1);
}
if (check) {
  console.log('Android benchmark configuration is complete and private.');
  process.exit(0);
}

// Only an actual build needs native Firebase files; --check stays credentials-only.
let identity;
try {
  const appConfigSource = readFileSync(join(appDir, 'config/development-storefront-expo-config-production.js'), 'utf8');
  const googleServicesSource = readFileSync(join(appDir, 'google-services.json'), 'utf8');
  identity = resolveBenchmarkIdentity(appConfigSource, googleServicesSource, useInstalledDebugPackage);
} catch (error) {
  const message = error instanceof Error && /^(Existing Firebase|Could not determine|The existing Firebase)/.test(error.message)
    ? error.message
    : 'Could not read the Android package or existing Firebase configuration.';
  console.error(message);
  process.exit(1);
}
console.log(`Benchmark target package: ${identity.targetPackage}`);

// The release workflow supplies the same client configuration at prebuild and bundle time.
// Sentry documents these flags. PostHog's installed Gradle script has no upload opt-out;
// the temporary init script disables its upload tasks without changing tracked files.
const inheritedEnv = Object.fromEntries(
  Object.entries(process.env).filter(([key]) =>
    !/^(EXPO_PUBLIC_|STOREFRONT_|SENTRY_|POSTHOG_|ANDROID_KEYSTORE_|ANDROID_KEY_ALIAS$|ANDROID_KEY_PASSWORD$|EAS_|CI$|EXPO_UPDATE_CHANNEL$)/.test(key)
  )
);
const env = { ...inheritedEnv, ...config, NODE_ENV: 'production', EXPO_PUBLIC_ENV: 'preview', EXPO_PUBLIC_SENTRY_ENVIRONMENT: 'benchmark', EXPO_NO_DOTENV: '1', SENTRY_DISABLE_AUTO_UPLOAD: 'true', SENTRY_DISABLE_NATIVE_DEBUG_UPLOAD: 'true' };
const sdk = env.ANDROID_HOME || env.ANDROID_SDK_ROOT || [
  join(homedir(), 'Library/Android/sdk'),
  join(homedir(), 'Android/Sdk'),
].find(existsSync);
if (!sdk || !existsSync(sdk)) {
  console.error('Android SDK not found. Set ANDROID_HOME to the installed SDK directory.');
  process.exit(1);
}
env.ANDROID_HOME = sdk;
// Never read or use the production signing keystore for a local benchmark.
for (const key of ['ANDROID_KEYSTORE_FILE', 'ANDROID_KEYSTORE_PASSWORD', 'ANDROID_KEY_ALIAS', 'ANDROID_KEY_PASSWORD']) delete env[key];
const temp = mkdtempSync(join(tmpdir(), 'baci-android-benchmark-'));
chmodSync(temp, 0o700);
const initFile = join(temp, 'benchmark.gradle');
const testFile = join(appDir, 'android/settings-gradle-include-build.test.mjs');
const testBackup = existsSync(testFile) ? readFileSync(testFile) : null;
const init = createAndroidBenchmarkGradleInit(identity);

function execute(label, command, commandArgs, cwd) {
  console.log(`${label}…`);
  const rawLog = join(temp, 'step-output.log');
  const descriptor = openSync(rawLog, 'w', 0o600);
  let result;
  try {
    result = spawnSync(command, commandArgs, {
      cwd, env, stdio: ['ignore', descriptor, descriptor],
    });
  } finally {
    closeSync(descriptor);
  }
  if (!result.error && result.status === 0) {
    rmSync(rawLog, { force: true });
    return;
  }
  // Retain only the final 4 MiB; drop a partial first line so a truncated
  // configured value cannot escape the redactor as an unmatched suffix.
  const reader = openSync(rawLog, 'r');
  let contents;
  try {
    contents = readFileSync(rawLog, 'utf8');
  } finally {
    closeSync(reader);
  }

  const privateValues = new Set([
    ...Object.values(config),
    ...Object.entries(env)
      .filter(([key]) => /(?:SECRET|TOKEN|PASSWORD|API_KEY|PRIVATE_KEY)/i.test(key))
      .map(([, value]) => value),
  ].filter((value) => typeof value === 'string' && value.length > 0));
  let output = `${label}; exit ${result.status ?? 'unavailable'}\n${contents}`;
  if (result.error) output += '\nProcess could not be started or was interrupted.';
  output = redactPrivateValuesAndLimit(output, privateValues, 4 * 1024 * 1024);
  const logBase = join(homedir(), '.local/state/baci/android-benchmark');
  mkdirSync(logBase, { recursive: true, mode: 0o700 });
  const logDir = mkdtempSync(join(logBase, 'run-'));
  chmodSync(logDir, 0o700);
  const logFile = join(logDir, 'failure.log');
  writeFileSync(logFile, output, { mode: 0o600 });
  throw new Error(`${label} failed. Redacted diagnostics: ${logFile}`);
}

try {
  writeFileSync(initFile, init, { mode: 0o600 });
  try {
    execute('Generating native project', process.execPath, [require.resolve('expo/bin/cli'), 'prebuild', '--platform', 'android', '--no-install', '--no-clean'], appDir);
  } finally {
    if (testBackup && !existsSync(testFile)) writeFileSync(testFile, testBackup, { flag: 'wx' });
  }
  execute('Building release benchmark APK', join(appDir, 'android/gradlew'), ['--init-script', initFile, ':app:assembleRelease', '-Dorg.gradle.jvmargs=-Xmx4096m -XX:MaxMetaspaceSize=1024m -XX:ActiveProcessorCount=2 -Dfile.encoding=UTF-8', '-PreactNativeArchitectures=arm64-v8a', '-Pandroid.enableMinifyInReleaseBuilds=true', '-Pandroid.enableShrinkResourcesInReleaseBuilds=true', '--max-workers=2', '--console=plain'], join(appDir, 'android'));
  const benchmarkApk = join(appDir, 'android/app/build/outputs/apk/release/app-release.apk');
  validateBenchmarkApk({ appDir, artifactPath: benchmarkApk, execute });
  console.log(`Benchmark APK: ${benchmarkApk}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Android benchmark build failed.');
  process.exitCode = 1;
} finally {
  rmSync(temp, { recursive: true, force: true });
}
