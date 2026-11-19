const projectId = 'c6c1897b-cac8-49b0-85f9-3d277aecc379';

export const STOREFRONT_OTA_CONFIG = Object.freeze({
  apiUrl: 'https://usebaci.com',
  bundleIdentifier: 'com.ogabassey.app',
  channel: 'production',
  merchantDomain: 'ogabassey.com',
  merchantId: '6b5cb8a4-5575-456c-b936-8cdfae30db74',
  merchantSlug: 'ogabassey',
  projectId,
  updatesUrl: `https://u.expo.dev/${projectId}`,
});

// Operators select the runtime embedded in the target iOS build. Builds from
// before the SDK 58 upgrade embed the plain app version ("2.1.663"); later
// builds append the native stack ("2.1.663-ios-sdk58-rn0880", see the
// runtimeVersion in the storefront app config). The build number is always the
// last segment of the app version.
export function parseIosRuntime(runtime) {
  const match = typeof runtime === 'string' && /^(\d+\.\d+\.(\d+))(?:-ios-sdk58-rn0880)?$/.exec(runtime);
  if (!match) throw new Error('Invalid iOS runtime.');
  return { appVersion: match[1], buildNumber: match[2] };
}
