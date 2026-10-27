import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const reactNativeRoot = path.dirname(require.resolve('react-native/package.json'));
const reactNativeAndroidRoot = path.resolve(
  reactNativeRoot,
  'ReactAndroid/src/main/java/com/facebook/react'
);
const androidSettingsPath = path.resolve(
  __dirname,
  '../android/settings.gradle'
);
const reactNativeAndroidBuildPath = path.resolve(
  reactNativeRoot,
  'ReactAndroid/build.gradle.kts'
);

function readReactNativeSource(relativePath: string) {
  return readFileSync(path.join(reactNativeAndroidRoot, relativePath), 'utf8');
}

describe('mobile admin Android edge-to-edge dependency guard', () => {
  it('compiles the patched React Native source instead of the prebuilt AAR', () => {
    const settingsGradle = readFileSync(androidSettingsPath, 'utf8');

    expect(settingsGradle).toContain(
      'substitute(module("com.facebook.react:react-android"))'
    );
    expect(settingsGradle).toContain(
      'project(":packages:react-native:ReactAndroid")'
    );
  });

  it('keeps Hermes precompiled while React Native is built from source', () => {
    const reactNativeBuild = readFileSync(reactNativeAndroidBuildPath, 'utf8');

    const hermesProperties = readFileSync(
      path.join(reactNativeRoot, 'sdks/hermes-engine/version.properties'), 'utf8'
    );
    const hermesVersion = hermesProperties.match(/^HERMES_VERSION_NAME=(.+)$/m)?.[1];
    expect(hermesVersion).toBeTruthy();
    expect(reactNativeBuild).toContain(
      `compileOnly("com.facebook.hermes:hermes-android:${hermesVersion}")`
    );
    expect(reactNativeBuild).not.toContain(
      'compileOnly(project(":packages:react-native:ReactAndroid:hermes-engine"))'
    );
  });

  it('keeps deprecated status-bar color APIs out of React Native bytecode inputs', () => {
    const statusBarModule = readReactNativeSource(
      'modules/statusbar/StatusBarModule.kt'
    );

    expect(statusBarModule).not.toContain('statusBarColor');
  });

  it('uses the upstream StatusBar API without the removed color and translucency methods', () => {
    const source = readReactNativeSource('modules/statusbar/StatusBarModule.kt');
    expect(source).not.toMatch(/override fun (setColor|setTranslucent)\(/);
    expect(source).toContain('override fun setHidden');
    expect(source).toContain('override fun setStyle');
  });

  it('removes deprecated system-bar colors and cutout modes from WindowUtil', () => {
    const windowUtil = readReactNativeSource('views/view/WindowUtil.kt');

    for (const deprecatedToken of [
      'statusBarColor',
      'navigationBarColor',
      'LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES',
      'LAYOUT_IN_DISPLAY_CUTOUT_MODE_DEFAULT',
    ]) {
      expect(windowUtil).not.toContain(deprecatedToken);
    }
  });
});
