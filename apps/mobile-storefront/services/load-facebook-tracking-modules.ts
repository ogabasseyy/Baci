/**
 * Loads Facebook tracking modules after native Settings initialization.
 *
 * Pins `react-native-fbsdk-next@13.4.3` and imports private `src/*` modules so
 * Settings can initialize before the package barrel eagerly constructs login/
 * event natives. Keep those paths when upgrading the exact pin.
 */
export async function loadFacebookTrackingModules(
  appId: string,
  clientToken: string
) {
  const { default: settings } = await import(
    'react-native-fbsdk-next/src/FBSettings'
  );
  settings.setAppID(appId);
  settings.setClientToken(clientToken);
  // Patched initializeSDK returns a Promise that resolves after native
  // fullyInitialize / ApplicationDelegate.initializeSDK on Android and iOS.
  // Do not use getAdvertiserTrackingEnabled — it is a JS no-op on Android.
  await settings.initializeSDK();
  const [eventsModule, aemModule] = await Promise.all([
    import('react-native-fbsdk-next/src/FBAppEventsLogger'),
    import('react-native-fbsdk-next/src/FBAEMReporter'),
  ]);
  return {
    settings,
    events: eventsModule.default,
    aem: aemModule.default,
  };
}
