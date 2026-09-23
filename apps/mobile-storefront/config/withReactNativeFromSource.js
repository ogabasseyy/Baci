const { withSettingsGradle } = require('@expo/config-plugins');

const INCLUDE_BUILD_PREFIX = 'includeBuild(expoAutolinking.reactNative)';

const REACT_NATIVE_FROM_SOURCE_BLOCK = `${INCLUDE_BUILD_PREFIX} {
  dependencySubstitution {
    substitute(module("com.facebook.react:react-android")).using(project(":packages:react-native:ReactAndroid"))
    substitute(module("com.facebook.react:react-native")).using(project(":packages:react-native:ReactAndroid"))
    substitute(module("com.facebook.react:hermes-android")).using(project(":packages:react-native:ReactAndroid:hermes-engine"))
    substitute(module("com.facebook.react:hermes-engine")).using(project(":packages:react-native:ReactAndroid:hermes-engine"))
  }
}
`;

function findMatchingBraceIndex(contents, openBraceIndex) {
  let depth = 0;
  for (let i = openBraceIndex; i < contents.length; i += 1) {
    const ch = contents[i];
    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Removes every includeBuild(expoAutolinking.reactNative) { ... } block. */
function stripReactNativeIncludeBuilds(contents) {
  let result = contents;
  for (;;) {
    const start = result.indexOf(INCLUDE_BUILD_PREFIX);
    if (start === -1) return result;
    const openBrace = result.indexOf('{', start);
    if (openBrace === -1) {
      return `${result.slice(0, start).trimEnd()}\n`;
    }
    const closeBrace = findMatchingBraceIndex(result, openBrace);
    if (closeBrace === -1) {
      return `${result.slice(0, start).trimEnd()}\n`;
    }
    result = `${result.slice(0, start)}${result.slice(closeBrace + 1)}`;
  }
}

/**
 * Ensures exactly one from-source ReactAndroid composite build after clean or
 * incremental prebuild (expo-build-properties may append duplicates).
 */
function ensureReactNativeFromSourceSettings(contents) {
  const stripped = stripReactNativeIncludeBuilds(contents).trimEnd();
  return `${stripped}\n\n${REACT_NATIVE_FROM_SOURCE_BLOCK}`;
}

function withReactNativeFromSource(config) {
  return withSettingsGradle(config, (configWithGradle) => {
    configWithGradle.modResults.contents = ensureReactNativeFromSourceSettings(
      configWithGradle.modResults.contents
    );
    return configWithGradle;
  });
}

// Expo's plugin loader requires module.exports to be the config-plugin function.
module.exports = withReactNativeFromSource;
module.exports.ensureReactNativeFromSourceSettings =
  ensureReactNativeFromSourceSettings;
module.exports.stripReactNativeIncludeBuilds = stripReactNativeIncludeBuilds;
