const DEFAULT_APP_VERSION = '2.0.1';

function resolveAndroidVersionCode(rawAndroidVersionCode) {
  if (rawAndroidVersionCode === undefined) {
    return undefined;
  }

  const parsedAndroidVersionCode = Number(rawAndroidVersionCode);

  if (!Number.isInteger(parsedAndroidVersionCode)) {
    console.warn(
      `[app.config] Ignoring ANDROID_VERSION_CODE="${rawAndroidVersionCode}" because it is not an integer.`
    );
    return undefined;
  }

  if (parsedAndroidVersionCode <= 0) {
    console.warn(
      `[app.config] Ignoring ANDROID_VERSION_CODE="${rawAndroidVersionCode}" because it must be greater than 0.`
    );
    return undefined;
  }

  if (parsedAndroidVersionCode > 2_100_000_000) {
    console.warn(
      `[app.config] Ignoring ANDROID_VERSION_CODE="${rawAndroidVersionCode}" because it exceeds 2100000000.`
    );
    return undefined;
  }

  return parsedAndroidVersionCode;
}

function resolveIosBuildNumber(rawIosBuildNumber) {
  if (rawIosBuildNumber === undefined) {
    return undefined;
  }

  const parsed = Number(rawIosBuildNumber);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    console.warn(
      `[app.config] Ignoring IOS_BUILD_NUMBER="${rawIosBuildNumber}" because it must be a positive integer.`
    );
    return undefined;
  }

  return String(parsed);
}

/**
 * Human-facing app version (Android versionName + iOS CFBundleShortVersionString).
 * Release workflows inject APP_VERSION (Android) or legacy IOS_APP_VERSION (iOS).
 * Use `||` (not `??`) so empty/whitespace APP_VERSION still falls through.
 */
function resolveAppVersion(environment = process.env) {
  const rawAppVersion =
    environment.APP_VERSION?.trim() || environment.IOS_APP_VERSION?.trim();

  if (!rawAppVersion) {
    return undefined;
  }

  if (!/^\d+\.\d+\.\d+$/.test(rawAppVersion)) {
    throw new Error(
      `[app.config] Invalid app version "${rawAppVersion}" (from APP_VERSION/IOS_APP_VERSION). Must be semantic version major.minor.patch (e.g., 2.0.31).`
    );
  }

  return rawAppVersion;
}

module.exports = {
  DEFAULT_APP_VERSION,
  resolveAndroidVersionCode,
  resolveAppVersion,
  resolveIosBuildNumber,
};
