const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('node:fs');
const ensurePostHogAndroidPlugin = require('./withAndroidGradleFixes.posthog');
const path = require('node:path');
const {
  addAsyncStorageRepo,
  assertReplaceOrThrow,
  ensureAmazonSdkOptimizationScope,
  ensureGoogleCodeScannerOrientationIsUnrestricted,
  ensureGradleProperty,
  ensureMergedJvmArgs,
  ensureR8ClassRepackaging,
  ensureGradleWrapperVersion,
  ensureReleaseSigning,
  fixProguardOptimize,
  removeKotlinGradlePlugin,
} = require('../../../.github/scripts/expoAndroidGradleFixes');
const ensurePatchedReactNativeBuild = require('./ensurePatchedReactNativeBuild');

const MATERIAL_COMPONENTS_DEPENDENCY =
  'implementation("com.google.android.material:material:1.14.0")';

function ensureAdminCodegenOrdering(content) {
  if (content.includes('generateAutolinkingNewArchitectureFiles')) {
    return content;
  }

  return assertReplaceOrThrow(
    content,
    /\/\*\*\s*\n \* Set this to true in release builds/m,
    `gradle.projectsEvaluated {
    def autolinkingTask = tasks.named("generateAutolinkingNewArchitectureFiles").get()

    rootProject.allprojects { subproject ->
        subproject.tasks.matching { task ->
            task.name == "generateCodegenArtifactsFromSchema" || task.name == "generateCodegenSchemaFromJavaScript"
        }.configureEach { codegenTask ->
            autolinkingTask.dependsOn(codegenTask)
        }
    }

    autolinkingTask.outputs.upToDateWhen { false }
}

/**
 * Set this to true in release builds`,
    'admin codegen ordering injection'
  );
}

function ensureWorkletsPickFirst(content) {
  if (content.includes("pickFirsts += ['**/libworklets.so']")) {
    return content;
  }

  return assertReplaceOrThrow(
    content,
    /useLegacyPackaging enableLegacyPackaging\.toBoolean\(\)\n/m,
    `useLegacyPackaging enableLegacyPackaging.toBoolean()
            pickFirsts += ['**/libworklets.so']
`,
    'worklets pickFirsts injection'
  );
}

function ensureMaterialComponentsDependency(content) {
  if (content.includes(MATERIAL_COMPONENTS_DEPENDENCY)) {
    return content;
  }

  return assertReplaceOrThrow(
    content,
    /dependencies\s*\{\s*\n/m,
    (match) => `${match}    ${MATERIAL_COMPONENTS_DEPENDENCY}\n`,
    'Material Components 1.14 dependency injection'
  );
}

function ensureKotlinAndroidPlugin(content) {
  if (content.includes('org.jetbrains.kotlin.android')) {
    return content;
  }

  return assertReplaceOrThrow(
    content,
    /(apply plugin:\s*(["'])com\.android\.application\2\s*\n)/,
    '$1apply plugin: "org.jetbrains.kotlin.android"\n',
    'kotlin.android plugin retention'
  );
}

function ensureDebugFirebaseAutoInitDisabled(content) {
  let updated = content;
  const metadata = [
    '<meta-data android:name="firebase_messaging_auto_init_enabled" android:value="false" tools:replace="android:value" />',
    '<meta-data android:name="firebase_analytics_collection_enabled" android:value="false" tools:replace="android:value" />',
  ];

  if (metadata.every((line) => updated.includes(line))) {
    return updated;
  }

  const selfClosingApplication = updated.match(/<application\b[^>]*\/>/m);
  if (selfClosingApplication) {
    const openingApplication = selfClosingApplication[0].replace(
      /\s*\/>$/,
      '>'
    );
    updated = updated.replace(
      selfClosingApplication[0],
      `${openingApplication}
    </application>`
    );
  }

  for (const line of metadata) {
    if (updated.includes(line)) {
      continue;
    }

    updated = assertReplaceOrThrow(
      updated,
      /\n\s*<\/application>/m,
      `\n        ${line}
    </application>`,
      'debug Firebase auto-init metadata injection'
    );
  }

  return updated;
}

function ensureDebugManifestsFirebaseAutoInitDisabled(platformProjectRoot) {
  for (const relativeManifest of [
    'app/src/debug/AndroidManifest.xml',
    'app/src/debugOptimized/AndroidManifest.xml',
  ]) {
    const manifestPath = path.join(platformProjectRoot, relativeManifest);

    if (!fs.existsSync(manifestPath)) {
      continue;
    }

    const content = fs.readFileSync(manifestPath, 'utf-8');
    fs.writeFileSync(
      manifestPath,
      ensureDebugFirebaseAutoInitDisabled(content)
    );
  }
}

function withAndroidGradleFixes(config) {
  const updatedConfig = withDangerousMod(config, [
    'android',
    (cfg) => {
      const settingsGradle = path.join(
        cfg.modRequest.platformProjectRoot,
        'settings.gradle'
      );

      if (fs.existsSync(settingsGradle)) {
        const content = fs.readFileSync(settingsGradle, 'utf-8');
        fs.writeFileSync(
          settingsGradle,
          ensurePatchedReactNativeBuild(content)
        );
      }

      const rootBuildGradle = path.join(
        cfg.modRequest.platformProjectRoot,
        'build.gradle'
      );

      if (fs.existsSync(rootBuildGradle)) {
        let content = fs.readFileSync(rootBuildGradle, 'utf-8');

        content = removeKotlinGradlePlugin(
          content,
          'kotlin-gradle-plugin classpath removal'
        );

        const asyncStorageRepo =
          'maven { url "$rootDir/../../../node_modules/@react-native-async-storage/async-storage/android/local_repo" }';
        content = addAsyncStorageRepo(
          content,
          asyncStorageRepo,
          'async-storage maven repo injection'
        );

        fs.writeFileSync(rootBuildGradle, content);
      }

      const appBuildGradle = path.join(
        cfg.modRequest.platformProjectRoot,
        'app',
        'build.gradle'
      );

      if (fs.existsSync(appBuildGradle)) {
        let content = fs.readFileSync(appBuildGradle, 'utf-8');

        // Keep kotlin.android plugin for MainApplication/MainActivity compilation.
        // android.builtInKotlin=false means AGP will not compile Kotlin by itself.
        content = ensureKotlinAndroidPlugin(content);
        content = ensurePostHogAndroidPlugin(content);

        content = fixProguardOptimize(content, 'proguard optimize rewrite');

        content = ensureAdminCodegenOrdering(content);
        content = ensureReleaseSigning(content);
        content = ensureWorkletsPickFirst(content);
        content = ensureMaterialComponentsDependency(content);

        fs.writeFileSync(appBuildGradle, content);
      }

      const proguardRules = path.join(
        cfg.modRequest.platformProjectRoot,
        'app',
        'proguard-rules.pro'
      );

      if (fs.existsSync(proguardRules)) {
        const content = fs.readFileSync(proguardRules, 'utf-8');
        fs.writeFileSync(
          proguardRules,
          ensureR8ClassRepackaging(ensureAmazonSdkOptimizationScope(content))
        );
      }

      const mainManifest = path.join(
        cfg.modRequest.platformProjectRoot,
        'app',
        'src',
        'main',
        'AndroidManifest.xml'
      );

      if (fs.existsSync(mainManifest)) {
        const content = fs.readFileSync(mainManifest, 'utf-8');
        fs.writeFileSync(
          mainManifest,
          ensureGoogleCodeScannerOrientationIsUnrestricted(content)
        );
      }

      const gradleProperties = path.join(
        cfg.modRequest.platformProjectRoot,
        'gradle.properties'
      );

      if (fs.existsSync(gradleProperties)) {
        let content = fs.readFileSync(gradleProperties, 'utf-8');
        content = ensureGradleProperty(content, 'org.gradle.workers.max', '2');
        content = ensureGradleProperty(
          content,
          'android.builtInKotlin',
          'false'
        );
        content = ensureGradleProperty(
          content,
          'android.r8.optimizedResourceShrinking',
          'true'
        );
        content = ensureMergedJvmArgs(content, [
          '-Xmx2048m',
          '-XX:MaxMetaspaceSize=1024m',
        ]);
        fs.writeFileSync(gradleProperties, content);
      }

      const wrapperProps = path.join(
        cfg.modRequest.platformProjectRoot,
        'gradle',
        'wrapper',
        'gradle-wrapper.properties'
      );

      if (fs.existsSync(wrapperProps)) {
        let content = fs.readFileSync(wrapperProps, 'utf-8');
        content = ensureGradleWrapperVersion(content);
        fs.writeFileSync(wrapperProps, content);
      }

      ensureDebugManifestsFirebaseAutoInitDisabled(
        cfg.modRequest.platformProjectRoot
      );

      return cfg;
    },
  ]);

  return updatedConfig;
}

module.exports = withAndroidGradleFixes;
