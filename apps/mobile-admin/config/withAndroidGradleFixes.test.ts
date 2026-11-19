import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import Module, { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const tempRoots: string[] = [];
interface PluginConfig {
  modRequest: {
    platformProjectRoot: string;
  };
}

type DangerousModCallback = (config: PluginConfig) => PluginConfig;
type ModuleLoad = (
  request: string,
  parent: unknown,
  isMain: boolean
) => unknown;

interface ModuleWithLoad {
  _load: ModuleLoad;
}

const moduleWithLoad = Module as unknown as ModuleWithLoad;

function writeFile(root: string, relativePath: string, content: string) {
  const filePath = path.join(root, relativePath);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, content);
}

function defaultRootBuildGradle() {
  return `buildscript {
    dependencies {
        classpath('org.jetbrains.kotlin:kotlin-gradle-plugin')
    }
}

allprojects {
    repositories {
        google()
    }
}
`;
}

function defaultAppBuildGradle() {
  return `apply plugin: "com.android.application"
apply plugin: "org.jetbrains.kotlin.android"
apply plugin: "com.facebook.react"

android {
    packaging {
        jniLibs {
            useLegacyPackaging enableLegacyPackaging.toBoolean()
        }
    }

    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
    }

    buildTypes {
        release {
            signingConfig signingConfigs.debug
            proguardFiles getDefaultProguardFile('proguard-android.txt'), 'proguard-rules.pro'
        }
    }
}

dependencies {
    implementation("com.facebook.react:react-android")
}

/**
 * Set this to true in release builds
 */
`;
}

function defaultMainManifest() {
  return `<manifest xmlns:android="http://schemas.android.com/apk/res/android" xmlns:tools="http://schemas.android.com/tools">
  <application android:name=".MainApplication">
  </application>
</manifest>
`;
}

function defaultSettingsGradle() {
  return `pluginManagement {
  includeBuild("../../../node_modules/@react-native/gradle-plugin")
}

include ':app'
`;
}

function createAndroidProject(options?: {
  appBuildGradle?: string | null;
  gradleProperties?: string | null;
}) {
  const root = mkdtempSync(path.join(tmpdir(), 'baci-android-gradle-fixes-'));
  tempRoots.push(root);

  writeFile(root, 'build.gradle', defaultRootBuildGradle());
  writeFile(
    root,
    'gradle/wrapper/gradle-wrapper.properties',
    'distributionUrl=https\\://services.gradle.org/distributions/gradle-8.14.3-bin.zip\n'
  );

  if (options?.appBuildGradle !== null) {
    writeFile(
      root,
      'app/build.gradle',
      options?.appBuildGradle ?? defaultAppBuildGradle()
    );
  }

  if (options?.gradleProperties !== null) {
    writeFile(
      root,
      'gradle.properties',
      options?.gradleProperties ??
        'org.gradle.jvmargs=-Xmx1024m -XX:MaxMetaspaceSize=512m\n'
    );
  }

  writeFile(root, 'app/src/main/AndroidManifest.xml', defaultMainManifest());
  writeFile(root, 'app/proguard-rules.pro', '# Project rules\n');
  writeFile(root, 'settings.gradle', defaultSettingsGradle());

  return root;
}

function runPlugin(platformProjectRoot: string) {
  const pluginPath = require.resolve('./withAndroidGradleFixes.js');
  delete require.cache[pluginPath];

  const originalLoad = moduleWithLoad._load;
  moduleWithLoad._load = function mockedLoad(
    this: unknown,
    request: string,
    parent: unknown,
    isMain: boolean
  ): unknown {
    if (request === '@expo/config-plugins') {
      return {
        withDangerousMod: (
          config: PluginConfig,
          mod: ['android', DangerousModCallback]
        ) => mod[1](config),
      };
    }

    return Reflect.apply(originalLoad, this, [request, parent, isMain]);
  };

  try {
    const withAndroidGradleFixes = require(pluginPath) as (
      config: PluginConfig
    ) => PluginConfig;

    return withAndroidGradleFixes({
      modRequest: {
        platformProjectRoot,
      },
    });
  } finally {
    moduleWithLoad._load = originalLoad;
    delete require.cache[pluginPath];
  }
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

describe('withAndroidGradleFixes Kotlin compilation guard', () => {
  it('keeps the Kotlin Android plugin when built-in Kotlin is disabled', () => {
    const projectRoot = createAndroidProject();
    const config = runPlugin(projectRoot);
    runPlugin(projectRoot);
    const appBuildGradle = readFileSync(
      path.join(projectRoot, 'app/build.gradle'),
      'utf-8'
    );
    const gradleProperties = readFileSync(
      path.join(projectRoot, 'gradle.properties'),
      'utf-8'
    );
    const proguardRules = readFileSync(
      path.join(projectRoot, 'app/proguard-rules.pro'),
      'utf-8'
    );
    expect(config.modRequest.platformProjectRoot).toBe(projectRoot);
    expect(appBuildGradle).toContain(
      'apply plugin: "org.jetbrains.kotlin.android"'
    );
    expect(appBuildGradle).toContain('proguard-android-optimize.txt');
    expect(appBuildGradle).toContain(
      'implementation("com.google.android.material:material:1.14.0")'
    );
    expect(appBuildGradle).toContain("pickFirsts += ['**/libworklets.so']");
    expect(gradleProperties).toContain('org.gradle.workers.max=2');
    expect(gradleProperties).toContain('android.builtInKotlin=false');
    expect(gradleProperties).toContain(
      'android.r8.optimizedResourceShrinking=true'
    );
    expect(gradleProperties).toContain('-XX:MaxMetaspaceSize=1024m');
    expect(proguardRules).toContain('\n-repackageclasses\n');
    expect(proguardRules).toContain(
      '\n-keep,allowshrinking,allowobfuscation,allowoptimization class com.amazon.** { *; }\n'
    );
    expect(proguardRules).not.toMatch(/^-dontoptimize$/m);
  });

  it('removes the Google code scanner portrait restriction during manifest merging', () => {
    const projectRoot = createAndroidProject();
    runPlugin(projectRoot);
    const mainManifest = readFileSync(
      path.join(projectRoot, 'app/src/main/AndroidManifest.xml'),
      'utf-8'
    );
    expect(mainManifest).toContain(
      'android:name="com.google.mlkit.vision.codescanner.internal.GmsBarcodeScanningDelegateActivity"'
    );
    expect(mainManifest).toContain('tools:remove="android:screenOrientation"');
    expect(mainManifest).not.toContain('android:screenOrientation="portrait"');
  });

  it('builds React Native from the patched workspace source', () => {
    const projectRoot = createAndroidProject();

    runPlugin(projectRoot);

    const settingsGradle = readFileSync(
      path.join(projectRoot, 'settings.gradle'),
      'utf-8'
    );
    expect(settingsGradle).toContain(
      "require.resolve('react-native/package.json')"
    );
    expect(settingsGradle).toContain(
      'substitute(module("com.facebook.react:react-android"))'
    );
    expect(settingsGradle).toContain(
      'project(":packages:react-native:ReactAndroid")'
    );
  });

  it('restores the Kotlin Android plugin when a generated app Gradle file is missing it', () => {
    const projectRoot = createAndroidProject({
      appBuildGradle: defaultAppBuildGradle().replace(
        'apply plugin: "org.jetbrains.kotlin.android"\n',
        ''
      ),
    });

    runPlugin(projectRoot);
    expect(
      readFileSync(path.join(projectRoot, 'app/build.gradle'), 'utf-8')
    ).toContain('apply plugin: "org.jetbrains.kotlin.android"');
  });

  it('does not throw when app/build.gradle is missing', () => {
    const projectRoot = createAndroidProject({ appBuildGradle: null });

    expect(() => runPlugin(projectRoot)).not.toThrow();

    expect(
      readFileSync(path.join(projectRoot, 'gradle.properties'), 'utf-8')
    ).toContain('android.builtInKotlin=false');
  });

  it('does not throw when gradle.properties is missing', () => {
    const projectRoot = createAndroidProject({ gradleProperties: null });

    expect(() => runPlugin(projectRoot)).not.toThrow();

    expect(
      readFileSync(path.join(projectRoot, 'app/build.gradle'), 'utf-8')
    ).toContain('apply plugin: "org.jetbrains.kotlin.android"');
  });
});
