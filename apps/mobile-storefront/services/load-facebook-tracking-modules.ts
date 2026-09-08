/** Called only from the authorized ad-tracking initialization path. */
export async function loadFacebookTrackingModules(
  appId: string,
  clientToken: string
) {
  // The package barrel eagerly constructs login/event modules. Configure and
  // initialize Settings first so those native modules cannot run before the SDK.
  const { default: settings } = await import(
    'react-native-fbsdk-next/src/FBSettings'
  );
  settings.setAppID(appId);
  settings.setClientToken(clientToken);
  settings.initializeSDK();
  const [events, aem] = await Promise.all([
    import('react-native-fbsdk-next/src/FBAppEventsLogger'),
    import('react-native-fbsdk-next/src/FBAEMReporter'),
  ]);
  return [{ default: settings }, events, aem] as const;
}
