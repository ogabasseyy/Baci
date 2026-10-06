const PRODUCTION_PROJECT_ID = 'c6c1897b-cac8-49b0-85f9-3d277aecc379';
const PRODUCTION_NATIVE_IDS = ['com.ogabassey.app', 'com.ogabassey.store'];
const ORIGINS = [
  'https://staging.ogabassey.com',
  'https://staging-auth.ogabassey.com',
  'https://exp.host',
];
const FIELDS = [
  'projectId',
  'iosBundleIdentifier',
  'androidPackage',
  'allowedOrigins',
];
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IOS_ID_PATTERN = /^[A-Za-z][A-Za-z0-9-]*(?:\.[A-Za-z][A-Za-z0-9-]*)+$/;
const ANDROID_ID_PATTERN = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/;

function validateHostedStagingPushCapability(capability, pins) {
  if (capability === undefined)
    return {
      valid: false,
      blocker: 'No approved native staging identity is pinned',
    };
  if (
    !capability ||
    typeof capability !== 'object' ||
    Array.isArray(capability) ||
    Object.keys(capability).length !== FIELDS.length ||
    !FIELDS.every((field) => Object.hasOwn(capability, field)) ||
    typeof capability.projectId !== 'string' ||
    !UUID_PATTERN.test(capability.projectId) ||
    typeof capability.iosBundleIdentifier !== 'string' ||
    capability.iosBundleIdentifier.length > 255 ||
    !IOS_ID_PATTERN.test(capability.iosBundleIdentifier) ||
    typeof capability.androidPackage !== 'string' ||
    capability.androidPackage.length > 255 ||
    !ANDROID_ID_PATTERN.test(capability.androidPackage) ||
    !Array.isArray(capability.allowedOrigins) ||
    capability.allowedOrigins.length !== ORIGINS.length
  )
    return { valid: false, blocker: 'Native staging identity is invalid' };
  if (capability.projectId.toLowerCase() === PRODUCTION_PROJECT_ID)
    return {
      valid: false,
      blocker: 'The native staging project points to production',
    };
  if (
    [capability.iosBundleIdentifier, capability.androidPackage].some((value) =>
      PRODUCTION_NATIVE_IDS.includes(value.toLowerCase())
    )
  )
    return {
      valid: false,
      blocker: 'A native staging identifier points to production',
    };
  if (
    pins?.apiOrigin !== ORIGINS[0] ||
    pins?.supabaseOrigin !== ORIGINS[1] ||
    !ORIGINS.every(
      (origin, index) => capability.allowedOrigins[index] === origin
    )
  )
    return {
      valid: false,
      blocker: 'Push origins do not match the pinned staging endpoints',
    };
  return { valid: true, blocker: null };
}

module.exports = { validateHostedStagingPushCapability };
