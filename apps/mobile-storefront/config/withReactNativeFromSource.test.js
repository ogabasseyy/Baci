const {
  ensureReactNativeFromSourceSettings,
} = require('./withReactNativeFromSource');

describe('ensureReactNativeFromSourceSettings', () => {
  it('adds exactly one includeBuild for clean-prebuild-like settings.gradle', () => {
    const clean = `include ':app'\nincludeBuild(expoAutolinking.reactNativeGradlePlugin)\n`;
    const ensured = ensureReactNativeFromSourceSettings(clean);
    expect(
      ensured.match(/includeBuild\(expoAutolinking\.reactNative\)/g)
    ).toHaveLength(1);
  });

  it('collapses duplicate includeBuild blocks from expo-build-properties', () => {
    const duplicated = `include ':app'
includeBuild(expoAutolinking.reactNative) {
  dependencySubstitution {
    substitute(module("com.facebook.react:react-android")).using(project(":packages:react-native:ReactAndroid"))
  }
}
includeBuild(expoAutolinking.reactNative) {
  dependencySubstitution {
    substitute(module("com.facebook.react:react-android")).using(project(":packages:react-native:ReactAndroid"))
  }
}
`;
    expect(
      ensureReactNativeFromSourceSettings(duplicated).match(
        /includeBuild\(expoAutolinking\.reactNative\)/g
      )
    ).toHaveLength(1);
  });
});
