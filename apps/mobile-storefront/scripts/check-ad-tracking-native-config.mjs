import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import plist from 'plist';
import fastfileConfigValidator from './validate-fastfile-ad-tracking-config.cjs';

const { validateFastfileAdTrackingConfig } = fastfileConfigValidator;

const FACEBOOK_APP_ID_PLACEHOLDER = 'facebook_app_id_placeholder';
const FACEBOOK_CLIENT_TOKEN_PLACEHOLDER = 'facebook_client_token_placeholder';
const FACEBOOK_SCHEME_PLACEHOLDER = 'fb_placeholder';
const FACEBOOK_DISPLAY_NAME = 'Ogabassey';
const FACEBOOK_QUERY_SCHEMES = [
  'fbapi',
  'fb-messenger-api',
  'fbauth2',
  'fbshareextension',
];
const FACEBOOK_BUILD_PHASE_NAME = '[Baci] Configure Facebook SDK plist';

function parseArgs(argv) {
  const options = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--project-root') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) {
        throw new Error('Missing value for --project-root');
      }
      options.projectRoot = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function readRequiredFile(filePath) {
  if (!existsSync(filePath)) {
    throw new Error(`Missing file: ${filePath}`);
  }
  return readFileSync(filePath, 'utf8');
}

function extractQuotedPropertyValues(source, propertyName) {
  const pattern = new RegExp(`${propertyName}:\\s*(['"])([\\s\\S]*?)\\1`, 'g');
  return [...source.matchAll(pattern)].map((match) => match[2]);
}

function extractBooleanPropertyValues(source, propertyName) {
  const pattern = new RegExp(`${propertyName}:\\s*(true|false)`, 'g');
  return [...source.matchAll(pattern)].map((match) => match[1] === 'true');
}

function extractAppConfigAdDeclarations(appConfigSource) {
  const usageDescription = extractQuotedPropertyValues(
    appConfigSource,
    'NSUserTrackingUsageDescription'
  )[0];
  if (!usageDescription) {
    throw new Error(
      'Could not find quoted NSUserTrackingUsageDescription in app.config.ts'
    );
  }

  const skAdNetworkIds = extractQuotedPropertyValues(
    appConfigSource,
    'SKAdNetworkIdentifier'
  );
  if (skAdNetworkIds.length === 0) {
    throw new Error(
      'Could not find quoted SKAdNetworkIdentifier entries in app.config.ts'
    );
  }

  const tiktokAutoInitialize = extractBooleanPropertyValues(
    appConfigSource,
    'autoInitialize'
  )[0];
  if (tiktokAutoInitialize !== false) {
    throw new Error(
      'TikTok autoInitialize must be explicitly false in app.config.ts'
    );
  }

  return {
    skAdNetworkIds,
    tiktokAutoInitialize,
    usageDescription,
  };
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function getUrlSchemes(infoPlist) {
  return toArray(infoPlist.CFBundleURLTypes).flatMap((urlType) =>
    toArray(urlType?.CFBundleURLSchemes)
  );
}

function getSkAdNetworkIds(infoPlist) {
  return toArray(infoPlist.SKAdNetworkItems)
    .map((item) => item?.SKAdNetworkIdentifier)
    .filter((id) => typeof id === 'string');
}

function pushMissingValue(failures, label, actual, expected) {
  if (actual !== expected) {
    failures.push(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function pushMissingSetEntries(failures, label, actualValues, expectedValues) {
  const actualSet = new Set(actualValues);
  const missing = expectedValues.filter((value) => !actualSet.has(value));
  const stale = actualValues.filter((value) => !expectedValues.includes(value));

  if (missing.length > 0) {
    failures.push(`${label}: missing ${missing.join(', ')}`);
  }
  if (stale.length > 0) {
    failures.push(`${label}: unexpected ${stale.join(', ')}`);
  }
}

function validateInfoPlist(infoPlist, appConfigDeclarations) {
  const failures = [];

  pushMissingValue(
    failures,
    'NSUserTrackingUsageDescription',
    infoPlist.NSUserTrackingUsageDescription,
    appConfigDeclarations.usageDescription
  );
  pushMissingValue(
    failures,
    'BaciTikTokBusinessAutoInitialize',
    infoPlist.BaciTikTokBusinessAutoInitialize,
    appConfigDeclarations.tiktokAutoInitialize
  );
  pushMissingValue(
    failures,
    'FacebookAppID',
    infoPlist.FacebookAppID,
    FACEBOOK_APP_ID_PLACEHOLDER
  );
  pushMissingValue(
    failures,
    'FacebookClientToken',
    infoPlist.FacebookClientToken,
    FACEBOOK_CLIENT_TOKEN_PLACEHOLDER
  );
  pushMissingValue(
    failures,
    'FacebookDisplayName',
    infoPlist.FacebookDisplayName,
    FACEBOOK_DISPLAY_NAME
  );
  pushMissingValue(
    failures,
    'FacebookAutoInitEnabled',
    infoPlist.FacebookAutoInitEnabled,
    false
  );
  pushMissingValue(
    failures,
    'FacebookAutoLogAppEventsEnabled',
    infoPlist.FacebookAutoLogAppEventsEnabled,
    false
  );
  pushMissingValue(
    failures,
    'FacebookAdvertiserIDCollectionEnabled',
    infoPlist.FacebookAdvertiserIDCollectionEnabled,
    false
  );
  pushMissingSetEntries(
    failures,
    'CFBundleURLTypes Facebook URL schemes',
    getUrlSchemes(infoPlist).filter((scheme) => scheme.startsWith('fb')),
    [FACEBOOK_SCHEME_PLACEHOLDER]
  );
  pushMissingSetEntries(
    failures,
    'LSApplicationQueriesSchemes',
    toArray(infoPlist.LSApplicationQueriesSchemes),
    FACEBOOK_QUERY_SCHEMES
  );
  pushMissingSetEntries(
    failures,
    'SKAdNetworkItems',
    getSkAdNetworkIds(infoPlist),
    appConfigDeclarations.skAdNetworkIds
  );

  return failures;
}

function validateXcodeProject(projectSource) {
  const failures = [];

  if (!projectSource.includes(FACEBOOK_BUILD_PHASE_NAME)) {
    failures.push(`missing ${FACEBOOK_BUILD_PHASE_NAME} build phase`);
  }
  if (!projectSource.includes('STOREFRONT_FACEBOOK_APP_ID')) {
    failures.push('missing STOREFRONT_FACEBOOK_APP_ID build-time plist injection');
  }
  if (!projectSource.includes('STOREFRONT_FACEBOOK_CLIENT_TOKEN')) {
    failures.push('missing STOREFRONT_FACEBOOK_CLIENT_TOKEN build-time plist injection');
  }
  if (!projectSource.includes('refusing to continue without Facebook SDK plist injection')) {
    failures.push('missing Release fail-closed guard for Facebook SDK plist injection');
  }
  if (!projectSource.includes('Release builds require STOREFRONT_FACEBOOK_APP_ID and STOREFRONT_FACEBOOK_CLIENT_TOKEN')) {
    failures.push('missing Release fail-closed guard for absent Facebook SDK credentials');
  }
  if (projectSource.includes('CFBundleURLTypes:2:CFBundleURLSchemes:0')) {
    failures.push('Facebook URL scheme injection must not depend on a hardcoded CFBundleURLTypes array index');
  }
  if (!projectSource.includes('plistlib.load') || !projectSource.includes('scheme.startswith')) {
    failures.push('missing order-independent Facebook URL scheme plist injection');
  }

  return failures;
}

function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[ad-tracking-native-config] ${message}`);
    process.exitCode = 1;
    return;
  }

  const scriptFile = fileURLToPath(import.meta.url);
  const defaultProjectRoot = path.resolve(path.dirname(scriptFile), '..');
  const projectRoot = path.resolve(options.projectRoot ?? defaultProjectRoot);
  const appConfigPath = path.join(projectRoot, 'app.config.ts');
  // Split-config fallback: app.config.ts may be a dispatcher that selects
  // the production builder below (which carries the ad declarations).
  // Concatenation preserves extraction (first quoted match wins) and is a
  // no-op on monolithic trees where the module does not exist.
  const productionConfigPath = path.join(
    projectRoot,
    'config',
    'development-storefront-expo-config-production.ts'
  );
  const infoPlistPath = path.join(projectRoot, 'ios', 'Ogabassey', 'Info.plist');
  const xcodeProjectPath = path.join(
    projectRoot,
    'ios',
    'Ogabassey.xcodeproj',
    'project.pbxproj'
  );
  const fastfilePath = path.join(projectRoot, 'fastlane', 'Fastfile');

  let appConfigDeclarations;
  let infoPlist;
  let xcodeProjectSource;
  let fastfileSource;
  try {
    const appConfigSource = existsSync(productionConfigPath)
      ? `${readRequiredFile(appConfigPath)}\n${readRequiredFile(productionConfigPath)}`
      : readRequiredFile(appConfigPath);
    appConfigDeclarations = extractAppConfigAdDeclarations(appConfigSource);
    infoPlist = plist.parse(readRequiredFile(infoPlistPath));
    xcodeProjectSource = readRequiredFile(xcodeProjectPath);
    fastfileSource = readRequiredFile(fastfilePath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[ad-tracking-native-config] ${message}`);
    process.exitCode = 1;
    return;
  }

  const failures = [
    ...validateInfoPlist(infoPlist, appConfigDeclarations),
    ...validateXcodeProject(xcodeProjectSource),
    ...validateFastfileAdTrackingConfig(fastfileSource),
  ];

  if (failures.length === 0) {
    console.log('[ad-tracking-native-config] OK: committed iOS ad-tracking config matches app config.');
    return;
  }

  console.error('[ad-tracking-native-config] iOS ad-tracking native config drift:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exitCode = 1;
}

const entryPoint = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (entryPoint === fileURLToPath(import.meta.url)) {
  main();
}
