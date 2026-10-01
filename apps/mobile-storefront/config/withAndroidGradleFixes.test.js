const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

let mockPlatformProjectRoot;
const mockFinalizedModCalls = [];

jest.mock('@expo/config-plugins', () => ({
  withDangerousMod: (config, [, action]) =>
    action({
      ...config,
      modRequest: {
        ...(config.modRequest ?? {}),
        platformProjectRoot: mockPlatformProjectRoot,
      },
    }),
  withFinalizedMod: (config, [platform, action]) => {
    mockFinalizedModCalls.push({ action, platform });
    return config;
  },
}));

const withAndroidGradleFixes = require('./withAndroidGradleFixes');
const ensurePostHogAndroidUploadsEnabled = require('./withAndroidGradleFixes.posthog');

function writeProjectFile(projectRoot, relativePath, content) {
  const filePath = path.join(projectRoot, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function readProjectFile(projectRoot, relativePath) {
  return fs.readFileSync(path.join(projectRoot, relativePath), 'utf8');
}

describe('withAndroidGradleFixes', () => {
  afterEach(() => {
    if (mockPlatformProjectRoot) {
      fs.rmSync(mockPlatformProjectRoot, { force: true, recursive: true });
    }
    mockPlatformProjectRoot = undefined;
    mockFinalizedModCalls.length = 0;
  });

  it('sets PostHog skip-on-conflict before the upload plugin is applied', () => {
    const appBuildGradle =
      ensurePostHogAndroidUploadsEnabled(`apply plugin: "com.android.application"

apply from: new File(["node", "--print", "require('path').join(require('path').dirname(require.resolve('posthog-react-native')), '..', 'tooling', 'posthog.gradle')"].execute().text.trim())
`);

    expect(appBuildGradle).toContain('posthogReactNativeSkipOnConflict = true');
    expect(
      appBuildGradle.match(/posthogReactNativeSkipOnConflict = true/g)
    ).toHaveLength(1);
    expect(
      appBuildGradle.indexOf('posthogReactNativeSkipOnConflict = true')
    ).toBeLessThan(appBuildGradle.indexOf('posthog.gradle'));
  });

  it('applies Gradle fixes while retaining the Kotlin Android plugin', async () => {
    mockPlatformProjectRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'baci-gradle-')
    );
    writeProjectFile(
      mockPlatformProjectRoot,
      'build.gradle',
      `buildscript {
    dependencies {
        classpath("org.jetbrains.kotlin:kotlin-gradle-plugin")
    }
}

allprojects {
    repositories {
        google()
        mavenCentral()
    }
}
`
    );
    writeProjectFile(
      mockPlatformProjectRoot,
      'app/build.gradle',
      `apply plugin: "org.jetbrains.kotlin.android"

apply from: new File(["node", "--print", "require('path').join(require('path').dirname(require.resolve('posthog-react-native')), '..', 'tooling', 'posthog.gradle')"].execute().text.trim())

android {
    defaultConfig {
        applicationId 'com.ogabassey.store'
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
            proguardFiles getDefaultProguardFile("proguard-android.txt"), "proguard-rules.pro"
        }
    }
    packagingOptions {
        jniLibs {
            def enableLegacyPackaging = findProperty('expo.useLegacyPackaging') ?: 'false'
            useLegacyPackaging enableLegacyPackaging.toBoolean()
        }
    }
}
`
    );
    writeProjectFile(
      mockPlatformProjectRoot,
      'app/src/main/res/values/strings.xml',
      `<?xml version="1.0" encoding="utf-8"?>
<resources>
  <string name="app_name">Ogabassey</string>
  <string name="facebook_app_id">354703740472594</string>
  <string name="facebook_client_token">1530248058ff9f74e7599e43f17be3b2</string>
  <string name="fb_login_protocol_scheme">fb354703740472594</string>
</resources>`
    );
    writeProjectFile(
      mockPlatformProjectRoot,
      'gradle.properties',
      'org.gradle.jvmargs=-Xmx2048m\n'
    );
    writeProjectFile(
      mockPlatformProjectRoot,
      'gradle/wrapper/gradle-wrapper.properties',
      'distributionUrl=https\\://services.gradle.org/distributions/gradle-8.13-bin.zip\n'
    );

    withAndroidGradleFixes({ name: 'Ogabassey', slug: 'ogabassey' });
    withAndroidGradleFixes({ name: 'Ogabassey', slug: 'ogabassey' });

    fs.appendFileSync(
      path.join(mockPlatformProjectRoot, 'app/src/main/res/values/strings.xml'),
      '<string name="facebook_client_token">late-plugin-value</string>\n'
    );
    await mockFinalizedModCalls[0].action({
      modRequest: { platformProjectRoot: mockPlatformProjectRoot },
    });

    const rootBuildGradle = readProjectFile(
      mockPlatformProjectRoot,
      'build.gradle'
    );
    const appBuildGradle = readProjectFile(
      mockPlatformProjectRoot,
      'app/build.gradle'
    );
    const gradleProperties = readProjectFile(
      mockPlatformProjectRoot,
      'gradle.properties'
    );
    const wrapperProperties = readProjectFile(
      mockPlatformProjectRoot,
      'gradle/wrapper/gradle-wrapper.properties'
    );
    const stringsXml = readProjectFile(
      mockPlatformProjectRoot,
      'app/src/main/res/values/strings.xml'
    );

    expect(rootBuildGradle).not.toContain('kotlin-gradle-plugin');
    expect(rootBuildGradle).toContain(
      'node_modules/@react-native-async-storage/async-storage/android/local_repo'
    );
    expect(appBuildGradle).toContain(
      'apply plugin: "org.jetbrains.kotlin.android"'
    );
    expect(appBuildGradle).toContain('ANDROID_KEYSTORE_FILE');
    expect(appBuildGradle).toContain('signingConfig signingConfigs.release');
    expect(appBuildGradle).toContain('proguard-android-optimize.txt');
    const workletsPickFirstMatches =
      appBuildGradle.match(/pickFirsts \+= \['\*\*\/libworklets\.so'\]/g) ?? [];
    expect(workletsPickFirstMatches).toHaveLength(1);
    expect(appBuildGradle).toContain('posthog.gradle');
    expect(appBuildGradle).not.toContain(
      'PostHog Android source-map upload is best-effort'
    );
    expect(appBuildGradle).not.toContain('task.enabled = false');

    // Assert dynamic Facebook resValue injection
    expect(appBuildGradle).toContain(
      'def storefrontFacebookAppId = (System.getenv("STOREFRONT_FACEBOOK_APP_ID") ?: "").trim()'
    );
    expect(appBuildGradle).toContain(
      'def storefrontFacebookClientToken = (System.getenv("STOREFRONT_FACEBOOK_CLIENT_TOKEN") ?: "").trim()'
    );
    expect(appBuildGradle).toContain(
      'STOREFRONT_FACEBOOK_CLIENT_TOKEN is missing but STOREFRONT_FACEBOOK_APP_ID is configured.'
    );
    expect(appBuildGradle).toContain(
      'resValue "string", "facebook_app_id", storefrontFacebookAppId'
    );
    expect(appBuildGradle).toContain(
      'resValue "string", "facebook_client_token", storefrontFacebookClientToken'
    );
    expect(appBuildGradle).toContain(
      'resValue "string", "fb_login_protocol_scheme", "fb" + storefrontFacebookAppId'
    );
    expect(appBuildGradle).toContain(
      'resValue "string", "facebook_app_id", "facebook_app_id_placeholder"'
    );

    // Assert static Facebook secrets stripping
    expect(stringsXml).not.toContain('facebook_app_id');
    expect(stringsXml).not.toContain('facebook_client_token');
    expect(stringsXml).not.toContain('fb_login_protocol_scheme');
    expect(stringsXml).toContain('app_name');

    expect(gradleProperties).toContain('android.builtInKotlin=false');
    expect(gradleProperties).toContain(
      'android.r8.optimizedResourceShrinking=true'
    );
    expect(wrapperProperties).toContain('gradle-9.3.1-bin.zip');
    expect(wrapperProperties).toContain('distributionSha256Sum=');
  });
});
