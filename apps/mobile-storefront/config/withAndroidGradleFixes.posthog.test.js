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

function writeProjectFile(projectRoot, relativePath, content) {
  const filePath = path.join(projectRoot, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function readProjectFile(projectRoot, relativePath) {
  return fs.readFileSync(path.join(projectRoot, relativePath), 'utf8');
}

function writeMinimalAndroidProject(appBuildGradle) {
  mockPlatformProjectRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'baci-gradle-')
  );
  writeProjectFile(
    mockPlatformProjectRoot,
    'build.gradle',
    `allprojects {
    repositories {
        google()
        mavenCentral()
    }
}
`
  );
  writeProjectFile(mockPlatformProjectRoot, 'app/build.gradle', appBuildGradle);
}

describe('withAndroidGradleFixes PostHog uploads', () => {
  afterEach(() => {
    if (mockPlatformProjectRoot) {
      fs.rmSync(mockPlatformProjectRoot, { force: true, recursive: true });
    }
    mockPlatformProjectRoot = undefined;
    mockFinalizedModCalls.length = 0;
  });

  it('removes legacy guards that silently disabled source-map uploads', () => {
    writeMinimalAndroidProject(`apply from: new File(["node", "--print", "require('path').join(require('path').dirname(require.resolve('posthog-react-native')), '..', 'tooling', 'posthog.gradle')"].execute().text.trim())

// PostHog source-map uploads run after bundling via finalizedBy.
// Upload failures must not block Play Store release artifacts.
tasks.configureEach { task ->
    if (task.name.contains("_PostHogUpload_")) {
        logger.warn("WARNING: Disabling \${task.name}; PostHog Android source-map upload is best-effort and will not block release builds.")
        task.enabled = false
    }
}

// PostHog source-map uploads run after bundling via finalizedBy.
// Upload failures must not block Play Store release artifacts.
tasks.configureEach { task ->
    if (task.name.contains("_PostHogUpload_")) {
        logger.warn("WARNING: Disabling \${task.name}; PostHog Android source-map upload is best-effort and will not block release builds.")
        task.enabled = false
    }
}

android {
    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
    }

    packagingOptions {
        jniLibs {
            def enableLegacyPackaging = findProperty('expo.useLegacyPackaging') ?: 'false'
            useLegacyPackaging enableLegacyPackaging.toBoolean()
        }
    }

    buildTypes {
        debug {
            signingConfig signingConfigs.debug
        }
        release {
            signingConfig signingConfigs.debug
            proguardFiles getDefaultProguardFile("proguard-android.txt"), "proguard-rules.pro"
        }
    }
}
`);

    withAndroidGradleFixes({ name: 'Ogabassey', slug: 'ogabassey' });

    const appBuildGradle = readProjectFile(
      mockPlatformProjectRoot,
      'app/build.gradle'
    );

    expect(appBuildGradle).toContain('posthog.gradle');
    expect(appBuildGradle).not.toContain(
      'PostHog Android source-map upload is best-effort'
    );
    expect(appBuildGradle).not.toContain('task.enabled = false');
    expect(appBuildGradle).not.toContain('task.onlyIf { false }');
  });

  it('keeps PostHog uploads enabled when the finalized mod runs', async () => {
    writeMinimalAndroidProject(`apply plugin: "com.android.application"
apply plugin: "org.jetbrains.kotlin.android"

android {
    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
    }

    packagingOptions {
        jniLibs {
            def enableLegacyPackaging = findProperty('expo.useLegacyPackaging') ?: 'false'
            useLegacyPackaging enableLegacyPackaging.toBoolean()
        }
    }

    buildTypes {
        debug {
            signingConfig signingConfigs.debug
        }
        release {
            signingConfig signingConfigs.debug
            proguardFiles getDefaultProguardFile("proguard-android.txt"), "proguard-rules.pro"
        }
    }
}
`);

    withAndroidGradleFixes({ name: 'Ogabassey', slug: 'ogabassey' });

    expect(mockFinalizedModCalls).toHaveLength(1);
    expect(mockFinalizedModCalls[0].platform).toBe('android');
    expect(
      readProjectFile(mockPlatformProjectRoot, 'app/build.gradle')
    ).not.toContain('PostHog Android source-map upload is best-effort');

    fs.appendFileSync(
      path.join(mockPlatformProjectRoot, 'app', 'build.gradle'),
      `
apply from: new File(["node", "--print", "require('path').join(require('path').dirname(require.resolve('posthog-react-native')), '..', 'tooling', 'posthog.gradle')"].execute().text.trim())
`
    );

    await mockFinalizedModCalls[0].action({
      modRequest: {
        platformProjectRoot: mockPlatformProjectRoot,
      },
    });

    const appBuildGradle = readProjectFile(
      mockPlatformProjectRoot,
      'app/build.gradle'
    );

    expect(appBuildGradle).toContain('posthog.gradle');
    expect(appBuildGradle).toContain('apply plugin: "com.posthog.android"');
    expect(appBuildGradle).not.toContain(
      'PostHog Android source-map upload is best-effort'
    );
    expect(appBuildGradle).not.toContain('task.enabled = false');
  });
});
