/** Preserve native symbol upload when Expo regenerates the Android project. */
module.exports = function ensurePostHogAndroidPlugin(content) {
  if (
    !content.includes('posthog.gradle') ||
    /apply plugin:\s*["']com\.posthog\.android["']/.test(content)
  )
    return content;
  const androidPlugin =
    /^(\s*apply plugin:\s*["']com\.android\.application["']\s*)$/m;
  if (!androidPlugin.test(content))
    throw new Error(
      'Cannot enable PostHog Android plugin: application plugin not found'
    );
  return content.replace(
    androidPlugin,
    '$1\napply plugin: "com.posthog.android"'
  );
};
