/**
 * Expo config plugin: Android Gradle fixes for Expo + React Native
 *
 * Applies after `expo prebuild --clean` so native dirs are always correct:
 * 1. Removes kotlin-gradle-plugin classpath (built into AGP 9.x)
 * 2. Keeps apply plugin "org.jetbrains.kotlin.android" for Kotlin compilation
 * 3. Changes proguard-android.txt → proguard-android-optimize.txt
 * 4. Bumps Gradle wrapper to the repository-supported version
 * 5. Adds async-storage local maven repo
 * 6. Adds Worklets jniLibs pickFirst for release packaging
 * 7. Enables AGP 8.12's optimized resource shrinking pipeline
 */
const { withDangerousMod, withFinalizedMod } = require('@expo/config-plugins');
const fs = require('node:fs');
const path = require('node:path');
const {
  addAsyncStorageRepo,
  assertReplaceOrThrow,
  ensureGradleProperty,
  ensureMergedJvmArgs,
  ensureGradleWrapperVersion,
  ensureReleaseSigning,
  fixProguardOptimize,
  removeKotlinGradlePlugin,
} = require('../../../.github/scripts/expoAndroidGradleFixes');

const ensurePostHogAndroidUploadsEnabled = require('./withAndroidGradleFixes.posthog');

function getAndroidProjectRoot(modRequest) {
  if (modRequest?.platformProjectRoot) {
    return modRequest.platformProjectRoot;
  }

  if (modRequest?.projectRoot) {
    return path.join(modRequest.projectRoot, 'android');
  }

  return null;
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

function ensureFinalizedPostHogAndroidUploadsEnabled(modRequest) {
  const androidProjectRoot = getAndroidProjectRoot(modRequest);

  if (!androidProjectRoot) {
    return;
  }

  const appBuildGradle = path.join(androidProjectRoot, 'app', 'build.gradle');

  if (!fs.existsSync(appBuildGradle)) {
    return;
  }

  const content = fs.readFileSync(appBuildGradle, 'utf-8');
  const updatedContent = ensurePostHogAndroidUploadsEnabled(content);

  if (updatedContent !== content) {
    fs.writeFileSync(appBuildGradle, updatedContent);
  }
}

function stripStaticFacebookResources(modRequest) {
  const stringsXmlPath = path.join(
    modRequest.platformProjectRoot,
    'app',
    'src',
    'main',
    'res',
    'values',
    'strings.xml'
  );
  if (!fs.existsSync(stringsXmlPath)) return;

  let content = fs.readFileSync(stringsXmlPath, 'utf-8');
  for (const resourceName of [
    'facebook_app_id',
    'facebook_client_token',
    'fb_login_protocol_scheme',
  ]) {
    content = content.replace(
      new RegExp(`\\s*<string name="${resourceName}">.*?<\\/string>\\s*`, 'g'),
      '\n'
    );
  }
  fs.writeFileSync(stringsXmlPath, content.replace(/\n\s*\n/g, '\n'));
}

function withAndroidGradleFixes(config) {
  // Fix root build.gradle
  const updatedConfig = withDangerousMod(config, [
    'android',
    (cfg) => {
      const rootBuildGradle = path.join(
        cfg.modRequest.platformProjectRoot,
        'build.gradle'
      );

      if (fs.existsSync(rootBuildGradle)) {
        let content = fs.readFileSync(rootBuildGradle, 'utf-8');

        // Remove kotlin-gradle-plugin classpath
        content = removeKotlinGradlePlugin(
          content,
          `failed to remove kotlin-gradle-plugin from ${rootBuildGradle}`
        );

        // Add async-storage local maven repo if not present
        const asyncStorageRepo =
          'maven { url "$rootDir/../../../node_modules/@react-native-async-storage/async-storage/android/local_repo" }';
        content = addAsyncStorageRepo(
          content,
          asyncStorageRepo,
          `failed to inject async-storage repo into ${rootBuildGradle}`
        );

        fs.writeFileSync(rootBuildGradle, content);
      }

      // Fix app/build.gradle
      const appBuildGradle = path.join(
        cfg.modRequest.platformProjectRoot,
        'app',
        'build.gradle'
      );

      if (fs.existsSync(appBuildGradle)) {
        let content = fs.readFileSync(appBuildGradle, 'utf-8');

        // Keep kotlin.android plugin for compilation of MainApplication/MainActivity
        // (Removing it disables Kotlin compilation, causing ClassNotFoundException on MainApplication)

        // Fix proguard file name
        content = fixProguardOptimize(
          content,
          `failed to update Proguard optimize config in ${appBuildGradle}`
        );

        content = ensureReleaseSigning(content);
        content = ensureWorkletsPickFirst(content);
        content = ensurePostHogAndroidUploadsEnabled(content);

        // Dynamically inject Facebook SDK resource entries to avoid hardcoding secrets in VCS
        if (!content.includes('resValue "string", "facebook_app_id"')) {
          const searchStr = 'defaultConfig {';
          const index = content.indexOf(searchStr);
          if (index !== -1) {
            const insertIndex = index + searchStr.length;
            const resValues = `
        def storefrontFacebookAppId = (System.getenv("STOREFRONT_FACEBOOK_APP_ID") ?: "").trim()
        def storefrontFacebookClientToken = (System.getenv("STOREFRONT_FACEBOOK_CLIENT_TOKEN") ?: "").trim()

        boolean hasAppId = !storefrontFacebookAppId.isEmpty()
        boolean hasClientToken = !storefrontFacebookClientToken.isEmpty()

        if (hasAppId && !hasClientToken) {
            throw new GradleException("STOREFRONT_FACEBOOK_CLIENT_TOKEN is missing but STOREFRONT_FACEBOOK_APP_ID is configured.")
        } else if (!hasAppId && hasClientToken) {
            throw new GradleException("STOREFRONT_FACEBOOK_APP_ID is missing but STOREFRONT_FACEBOOK_CLIENT_TOKEN is configured.")
        }

        if (hasAppId && hasClientToken) {
            resValue "string", "facebook_app_id", storefrontFacebookAppId
            resValue "string", "facebook_client_token", storefrontFacebookClientToken
            resValue "string", "fb_login_protocol_scheme", "fb" + storefrontFacebookAppId
        } else {
            logger.warn("WARNING: Facebook App ID and Client Token are not configured. Facebook SDK features will not function correctly.")
            resValue "string", "facebook_app_id", "facebook_app_id_placeholder"
            resValue "string", "facebook_client_token", "facebook_client_token_placeholder"
            resValue "string", "fb_login_protocol_scheme", "fb_placeholder"
        }`;
            content =
              content.slice(0, insertIndex) +
              resValues +
              content.slice(insertIndex);
          }
        }

        fs.writeFileSync(appBuildGradle, content);
      }

      stripStaticFacebookResources(cfg.modRequest);

      const gradleProperties = path.join(
        cfg.modRequest.platformProjectRoot,
        'gradle.properties'
      );

      if (fs.existsSync(gradleProperties)) {
        let content = fs.readFileSync(gradleProperties, 'utf-8');
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

      // Fix Gradle wrapper version
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

      return cfg;
    },
  ]);

  return withFinalizedMod(updatedConfig, [
    'android',
    (cfg) => {
      ensureFinalizedPostHogAndroidUploadsEnabled(cfg.modRequest);
      stripStaticFacebookResources(cfg.modRequest);

      return cfg;
    },
  ]);
}

module.exports = withAndroidGradleFixes;
