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

    expect(reactNativeBuild).toContain(
      'compileOnly("com.facebook.hermes:hermes-android:250829098.0.16")'
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

  it('preserves StatusBar color and translucency behavior below Android 15', () => {
    const statusBarModule = readReactNativeSource(
      'modules/statusbar/StatusBarModule.kt'
    );

    expect(statusBarModule).toContain(
      'Build.VERSION.SDK_INT < Build.VERSION_CODES.VANILLA_ICE_CREAM'
    );
    expect(statusBarModule).toContain('} ?: "black"');
    expect(statusBarModule).toContain('getStatusBarColorCompat()');
    expect(statusBarModule).toContain(
      'setStatusBarColorCompat(animator.animatedValue as Int)'
    );
    expect(statusBarModule).toContain('setStatusBarColorCompat(color)');
    expect(statusBarModule).toContain(
      'activity.window?.setStatusBarTranslucency(translucent)'
    );
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
