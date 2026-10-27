const GRADLE_DISTRIBUTION = 'gradle-9.4.1-bin.zip';
const GRADLE_SHA256 =
  '2ab2958f2a1e51120c326cad6f385153bb11ee93b3c216c5fccebfdfbb7ec6cb';
const GOOGLE_CODE_SCANNER_ACTIVITY =
  'com.google.mlkit.vision.codescanner.internal.GmsBarcodeScanningDelegateActivity';

function assertReplaceOrThrow(content, pattern, replacement, description) {
  const updated = content.replace(pattern, replacement);
  if (updated === content) {
    throw new Error(
      `[withAndroidGradleFixes] Failed to update ${description}; upstream Gradle template changed.`
    );
  }
  return updated;
}

function ensureReleaseSigning(content) {
  if (content.includes('signingConfigs.release.storeFile != null')) {
    return content;
  }
  let updated = content;

  if (!updated.includes('ANDROID_KEYSTORE_FILE')) {
    updated = assertReplaceOrThrow(
      updated,
      /signingConfigs\s*\{\s*debug\s*\{[\s\S]*?keyPassword 'android'\s*\n\s*\}\s*\n\s*\}/m,
      `signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
        release {
            def keystorePath = System.getenv("ANDROID_KEYSTORE_FILE") ?: null
            def keystorePassword = System.getenv("ANDROID_KEYSTORE_PASSWORD") ?: null
            def keyAliasVal = System.getenv("ANDROID_KEY_ALIAS") ?: null
            def keyPasswordVal = System.getenv("ANDROID_KEY_PASSWORD") ?: null

            if (keystorePath != null) {
                if (!file(keystorePath).exists()) {
                    throw new GradleException(
                        "ANDROID_KEYSTORE_FILE is set to '\${keystorePath}' but the file does not exist."
                    )
                }
                if (!keystorePassword || !keyAliasVal || !keyPasswordVal) {
                    throw new GradleException(
                        "Release keystore found but signing credentials incomplete. " +
                        "Missing: " +
                        (!keystorePassword ? "ANDROID_KEYSTORE_PASSWORD " : "") +
                        (!keyAliasVal ? "ANDROID_KEY_ALIAS " : "") +
                        (!keyPasswordVal ? "ANDROID_KEY_PASSWORD " : "")
                    )
                }
                storeFile file(keystorePath)
                storePassword keystorePassword
                keyAlias keyAliasVal
                keyPassword keyPasswordVal
            }
        }
    }`,
      'release signingConfigs injection'
    );
  }

  return assertReplaceOrThrow(
    updated,
    /release\s*\{\s*(?:\/\/[^\n]*\n\s*)*signingConfig signingConfigs\.debug/m,
    `release {
            if (signingConfigs.release.storeFile != null) {
                signingConfig signingConfigs.release
            }`,
    'release signingConfig rewrite'
  );
}

function ensureGradleWrapperVersion(content) {
  const targetDistributionUrl = `distributionUrl=https\\://services.gradle.org/distributions/${GRADLE_DISTRIBUTION}`;
  let updated = content.includes(targetDistributionUrl)
    ? content
    : assertReplaceOrThrow(
        content,
        /distributionUrl=https\\:\/\/services\.gradle\.org\/distributions\/gradle-[^\n]+/,
        targetDistributionUrl,
        'Gradle distributionUrl rewrite'
      );

  if (updated.includes(`distributionSha256Sum=${GRADLE_SHA256}`)) {
    return updated;
  }

  if (updated.includes('distributionSha256Sum=')) {
    updated = assertReplaceOrThrow(
      updated,
      /distributionSha256Sum=.*\n?/,
      `distributionSha256Sum=${GRADLE_SHA256}\n`,
      'Gradle distributionSha256Sum rewrite'
    );
  } else {
    updated = assertReplaceOrThrow(
      updated,
      /(distributionUrl=.*\n)/,
      `$1distributionSha256Sum=${GRADLE_SHA256}\n`,
      'Gradle distributionSha256Sum insertion'
    );
  }

  return updated;
}

function getGradleProperty(content, key) {
  const propertyPattern = new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}=(.*)$`, 'm');
  const match = content.match(propertyPattern);
  return match ? match[1].trim() : null;
}

function ensureGradleProperty(content, key, value) {
  const propertyPattern = new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}=.*$`, 'm');
  if (propertyPattern.test(content)) {
    return content.replace(propertyPattern, `${key}=${value}`);
  }

  const separator = content.endsWith('\n') ? '' : '\n';
  return `${content}${separator}${key}=${value}\n`;
}

function getJvmArgKey(token) {
  if (token.startsWith('-Xmx')) {
    return '-Xmx';
  }
  if (token.startsWith('-Xms')) {
    return '-Xms';
  }
  if (token.startsWith('-XX:MaxMetaspaceSize=')) {
    return '-XX:MaxMetaspaceSize';
  }
  if (token.startsWith('-XX:MetaspaceSize=')) {
    return '-XX:MetaspaceSize';
  }

  return null;
}

function ensureMergedJvmArgs(content, desiredArgs) {
  const currentArgs = getGradleProperty(content, 'org.gradle.jvmargs') || '';
  const rawTokens = [];
  const mergedByKey = new Map();

  for (const token of currentArgs.split(/\s+/).filter(Boolean)) {
    const key = getJvmArgKey(token);
    if (key) {
      mergedByKey.set(key, token);
    } else if (!rawTokens.includes(token)) {
      rawTokens.push(token);
    }
  }

  for (const token of desiredArgs) {
    const key = getJvmArgKey(token);
    if (key) {
      mergedByKey.set(key, token);
    } else if (!rawTokens.includes(token)) {
      rawTokens.push(token);
    }
  }

  return ensureGradleProperty(
    content,
    'org.gradle.jvmargs',
    [...rawTokens, ...Array.from(mergedByKey.values())].join(' ')
  );
}

function removeKotlinGradlePlugin(content, description) {
  if (!content.includes('org.jetbrains.kotlin:kotlin-gradle-plugin')) {
    return content;
  }
  const result = assertReplaceOrThrow(
    content,
    /\s*classpath\((?:['"]org\.jetbrains\.kotlin:kotlin-gradle-plugin['"]|kotlinVersion\s*\?\s*['"]org\.jetbrains\.kotlin:kotlin-gradle-plugin:\$kotlinVersion['"]\s*:\s*['"]org\.jetbrains\.kotlin:kotlin-gradle-plugin['"])\)\s*\n?/g,
    '\n',
    description
  );
  const declaration = /^[ \t]*def kotlinVersion = findProperty\(['"]android\.kotlinVersion['"]\)[ \t]*\r?\n/m;
  const withoutDeclaration = result.replace(declaration, '');
  return /\bkotlinVersion\b/.test(withoutDeclaration) ? result : withoutDeclaration;
}

function addAsyncStorageRepo(content, asyncStorageRepo, description) {
  if (content.includes('async-storage')) {
    return content;
  }

  return assertReplaceOrThrow(
    content,
    /(allprojects\s*\{\s*repositories\s*\{)/,
    `$1\n    ${asyncStorageRepo}`,
    description
  );
}

function removeKotlinAndroidPlugin(content, description) {
  return assertReplaceOrThrow(
    content,
    /apply plugin:\s*["']org\.jetbrains\.kotlin\.android["']\s*\n?/g,
    '',
    description
  );
}

function fixProguardOptimize(content, description) {
  if (content.includes('proguard-android-optimize.txt')) {
    return content;
  }
  return assertReplaceOrThrow(
    content,
    /proguard-android\.txt/g,
    'proguard-android-optimize.txt',
    description
  );
}

function ensureR8ClassRepackaging(content) {
  if (/^\s*-repackageclasses(?:\s+\S+)?\s*$/m.test(content)) {
    return content;
  }

  const separator = content.endsWith('\n') ? '' : '\n';
  return `${content}${separator}\n# Repackage classes for stronger R8 optimization on AGP 8.x.\n-repackageclasses\n`;
}

function ensureAmazonSdkOptimizationScope(content) {
  const legacyScopedKeepRule =
    '-keep,allowshrinking,allowobfuscation class com.amazon.** { *; }';
  const scopedKeepRule =
    '-keep,allowshrinking,allowobfuscation,allowoptimization class com.amazon.** { *; }';
  if (content.includes(scopedKeepRule)) {
    return content;
  }
  if (content.includes(legacyScopedKeepRule)) {
    return content.replace(legacyScopedKeepRule, scopedKeepRule);
  }

  const separator = content.endsWith('\n') ? '' : '\n';
  return `${content}${separator}\n# Protect malformed Amazon SDK bytecode without disabling R8 globally.\n-dontwarn com.amazon.**\n${scopedKeepRule}\n-keepattributes *Annotation*\n`;
}

function ensureGoogleCodeScannerOrientationIsUnrestricted(content) {
  const activityOverride = `<activity android:name="${GOOGLE_CODE_SCANNER_ACTIVITY}" tools:remove="android:screenOrientation" />`;

  if (content.includes(activityOverride)) {
    return content;
  }

  let updated = content;
  const openingManifest = updated.match(/<manifest\b[^>]*>/)?.[0] ?? '';
  if (!/\bxmlns:tools\s*=/.test(openingManifest)) {
    updated = assertReplaceOrThrow(
      updated,
      /<manifest\b/,
      '<manifest xmlns:tools="http://schemas.android.com/tools"',
      'Android tools namespace injection'
    );
  }

  return assertReplaceOrThrow(
    updated,
    /\n\s*<\/application>/m,
    `\n        ${activityOverride}\n    </application>`,
    'Google code scanner orientation override injection'
  );
}

module.exports = {
  addAsyncStorageRepo,
  assertReplaceOrThrow,
  ensureAmazonSdkOptimizationScope,
  ensureGoogleCodeScannerOrientationIsUnrestricted,
  ensureGradleWrapperVersion,
  ensureGradleProperty,
  ensureMergedJvmArgs,
  getGradleProperty,
  getJvmArgKey,
  ensureReleaseSigning,
  ensureR8ClassRepackaging,
  fixProguardOptimize,
  removeKotlinAndroidPlugin,
  removeKotlinGradlePlugin,
};
