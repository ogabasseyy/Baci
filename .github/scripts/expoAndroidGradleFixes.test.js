const assert = require('node:assert/strict');
const test = require('node:test');
const {
  ensureAmazonSdkOptimizationScope,
  ensureGoogleCodeScannerOrientationIsUnrestricted,
  ensureGradleProperty,
  ensureMergedJvmArgs,
  ensureR8ClassRepackaging,
  fixProguardOptimize,
} = require('./expoAndroidGradleFixes.js');

test('ensureAmazonSdkOptimizationScope: adds scoped rules without disabling app optimization', () => {
  const initial = '# Project rules\n';
  const once = ensureAmazonSdkOptimizationScope(initial);
  const twice = ensureAmazonSdkOptimizationScope(once);

  assert.equal(twice, once);
  assert.match(
    once,
    /^-keep,allowshrinking,allowobfuscation,allowoptimization class com\.amazon\.\*\* \{ \*; \}$/m
  );
  assert.match(once, /^-dontwarn com\.amazon\.\*\*$/m);
  assert.match(once, /^-keepattributes \*Annotation\*$/m);
  assert.doesNotMatch(once, /^-dontoptimize$/m);
});

test('ensureAmazonSdkOptimizationScope: upgrades the legacy scoped keep rule', () => {
  const initial =
    '-keep,allowshrinking,allowobfuscation class com.amazon.** { *; }\n';
  const result = ensureAmazonSdkOptimizationScope(initial);

  assert.match(
    result,
    /^-keep,allowshrinking,allowobfuscation,allowoptimization class com\.amazon\.\*\* \{ \*; \}$/m
  );
  assert.doesNotMatch(
    result,
    /^-keep,allowshrinking,allowobfuscation class com\.amazon\.\*\* \{ \*; \}$/m
  );
});

test('ensureR8ClassRepackaging: appends one idempotent R8 rule', () => {
  const initial = '# Project rules\n';
  const once = ensureR8ClassRepackaging(initial);
  const twice = ensureR8ClassRepackaging(once);

  assert.equal(twice, once);
  assert.equal(once.match(/^-repackageclasses$/gm)?.length, 1);
});

test('ensureGoogleCodeScannerOrientationIsUnrestricted: adds an idempotent manifest override', () => {
  const initial = '<manifest><application>\n</application></manifest>';
  const once = ensureGoogleCodeScannerOrientationIsUnrestricted(initial);
  const twice = ensureGoogleCodeScannerOrientationIsUnrestricted(once);

  assert.equal(twice, once);
  assert.match(once, /xmlns:tools="http:\/\/schemas\.android\.com\/tools"/);
  assert.match(
    once,
    /android:name="com\.google\.mlkit\.vision\.codescanner\.internal\.GmsBarcodeScanningDelegateActivity"/
  );
  assert.match(once, /tools:remove="android:screenOrientation"/);
});

test('ensureGoogleCodeScannerOrientationIsUnrestricted: preserves a whitespace-formatted tools namespace', () => {
  const initial =
    '<manifest xmlns:tools = "http://schemas.android.com/tools"><application>\n</application></manifest>';
  const result = ensureGoogleCodeScannerOrientationIsUnrestricted(initial);

  assert.equal(result.match(/xmlns:tools/g)?.length, 1);
  assert.match(result, /tools:remove="android:screenOrientation"/);
});

test('ensureGoogleCodeScannerOrientationIsUnrestricted: adds the namespace to the manifest when only a child declares it', () => {
  const initial =
    '<manifest><application xmlns:tools="http://schemas.android.com/tools">\n</application></manifest>';
  const result = ensureGoogleCodeScannerOrientationIsUnrestricted(initial);
  const openingManifest = result.match(/<manifest\b[^>]*>/)?.[0];

  assert.match(
    openingManifest ?? '',
    /xmlns:tools="http:\/\/schemas\.android\.com\/tools"/
  );
  assert.match(result, /tools:remove="android:screenOrientation"/);
});

test('ensureGradleProperty: overwrites existing property', () => {
  const content = 'some.key=old_value\nanother.key=val';
  const result = ensureGradleProperty(content, 'some.key', 'new_value');
  assert.equal(result, 'some.key=new_value\nanother.key=val');
});

test('ensureGradleProperty: appends new property', () => {
  const content = 'another.key=val\n';
  const result = ensureGradleProperty(content, 'some.key', 'new_value');
  assert.equal(result, 'another.key=val\nsome.key=new_value\n');
});

test('ensureMergedJvmArgs: creates org.gradle.jvmargs if not exists', () => {
  const content = 'some.prop=value\n';
  const desiredArgs = ['-Xmx2048m', '-XX:MaxMetaspaceSize=1024m'];
  const result = ensureMergedJvmArgs(content, desiredArgs);
  assert.match(result, /org\.gradle\.jvmargs=-Xmx2048m -XX:MaxMetaspaceSize=1024m/);
});

test('ensureMergedJvmArgs: overrides existing JVM arguments with desired values', () => {
  const content = 'org.gradle.jvmargs=-Xmx1024m -XX:MaxMetaspaceSize=512m\nsome.prop=value';
  const desiredArgs = ['-Xmx2048m', '-XX:MaxMetaspaceSize=1024m'];
  const result = ensureMergedJvmArgs(content, desiredArgs);
  assert.match(result, /org\.gradle\.jvmargs=-Xmx2048m -XX:MaxMetaspaceSize=1024m/);
});

test('ensureMergedJvmArgs: preserves unrelated raw tokens and overrides specified ones', () => {
  const content = 'org.gradle.jvmargs=-Xmx1024m -XX:MaxMetaspaceSize=512m -XX:+UseG1GC\nsome.prop=value';
  const desiredArgs = ['-Xmx2048m', '-XX:MaxMetaspaceSize=1024m'];
  const result = ensureMergedJvmArgs(content, desiredArgs);

  // The result should have: -Xmx2048m, -XX:MaxMetaspaceSize=1024m, and -XX:+UseG1GC
  assert.match(result, /-Xmx2048m/);
  assert.match(result, /-XX:MaxMetaspaceSize=1024m/);
  assert.match(result, /-XX:\+UseG1GC/);
});

test('ensureMergedJvmArgs: preserves repeated key-value JVM flags outside managed memory args', () => {
  const content =
    'org.gradle.jvmargs=--add-opens=java.base/java.io=ALL-UNNAMED --add-opens=java.base/java.lang=ALL-UNNAMED -Xmx1024m\n';
  const desiredArgs = ['-Xmx2048m'];
  const result = ensureMergedJvmArgs(content, desiredArgs);

  assert.match(result, /--add-opens=java\.base\/java\.io=ALL-UNNAMED/);
  assert.match(result, /--add-opens=java\.base\/java\.lang=ALL-UNNAMED/);
  assert.match(result, /-Xmx2048m/);
});

test('ensureMergedJvmArgs: deduplicates unmanaged desired tokens already present', () => {
  const content =
    'org.gradle.jvmargs=-XX:+UseG1GC --add-opens=java.base/java.lang=ALL-UNNAMED\n';
  const desiredArgs = [
    '--add-opens=java.base/java.lang=ALL-UNNAMED',
    '-Xmx2048m',
  ];
  const result = ensureMergedJvmArgs(content, desiredArgs);

  const matches = result.match(/--add-opens=java\.base\/java\.lang=ALL-UNNAMED/g);
  assert.equal(matches?.length, 1);
  assert.match(result, /-XX:\+UseG1GC/);
  assert.match(result, /-Xmx2048m/);
});

test('ensureMergedJvmArgs: replaces initial heap and metaspace values', () => {
  const content =
    'org.gradle.jvmargs=-Xms256m -XX:MetaspaceSize=256m -Xmx1024m -XX:MaxMetaspaceSize=512m\n';
  const desiredArgs = [
    '-Xms512m',
    '-XX:MetaspaceSize=384m',
    '-Xmx2048m',
    '-XX:MaxMetaspaceSize=1024m',
  ];
  const result = ensureMergedJvmArgs(content, desiredArgs);

  assert.match(result, /-Xms512m/);
  assert.match(result, /-XX:MetaspaceSize=384m/);
  assert.match(result, /-Xmx2048m/);
  assert.match(result, /-XX:MaxMetaspaceSize=1024m/);
  assert.doesNotMatch(result, /-Xms256m/);
  assert.doesNotMatch(result, /-XX:MetaspaceSize=256m/);
});

test('fixProguardOptimize: updates Proguard filename if optimize not present', () => {
  const content = 'proguardFiles getDefaultProguardFile(\'proguard-android.txt\'), \'proguard-rules.pro\'';
  const result = fixProguardOptimize(content, 'test');
  assert.equal(result, 'proguardFiles getDefaultProguardFile(\'proguard-android-optimize.txt\'), \'proguard-rules.pro\'');
});

test('fixProguardOptimize: no-op if optimize already present', () => {
  const content = 'proguardFiles getDefaultProguardFile(\'proguard-android-optimize.txt\'), \'proguard-rules.pro\'';
  const result = fixProguardOptimize(content, 'test');
  assert.equal(result, content);
});

test('removeKotlinGradlePlugin: handles the SDK 58 conditional classpath and is idempotent', () => {
  const { removeKotlinGradlePlugin } = require('./expoAndroidGradleFixes.js');
  const input = `dependencies {
    classpath('com.android.tools.build:gradle')
    def kotlinVersion = findProperty('android.kotlinVersion')
    classpath(kotlinVersion ? "org.jetbrains.kotlin:kotlin-gradle-plugin:$kotlinVersion" : 'org.jetbrains.kotlin:kotlin-gradle-plugin')
    classpath('com.facebook.react:react-native-gradle-plugin')
  }`;
  const result = removeKotlinGradlePlugin(input, 'SDK 58 Kotlin classpath');
  assert.doesNotMatch(result, /org\.jetbrains\.kotlin:kotlin-gradle-plugin/);
  assert.doesNotMatch(result, /def kotlinVersion/);
  assert.match(result, /com\.android\.tools\.build:gradle/);
  assert.match(result, /com\.facebook\.react:react-native-gradle-plugin/);
  assert.equal(removeKotlinGradlePlugin(result, 'SDK 58 Kotlin classpath'), result);
});

test('Kotlin classpath cleanup retains a version declaration used elsewhere', () => {
  const { removeKotlinGradlePlugin } = require('./expoAndroidGradleFixes.js');
  const input = `dependencies {
    def kotlinVersion = findProperty('android.kotlinVersion')
    classpath(kotlinVersion ? "org.jetbrains.kotlin:kotlin-gradle-plugin:$kotlinVersion" : 'org.jetbrains.kotlin:kotlin-gradle-plugin')
    println kotlinVersion
  }`;
  const result = removeKotlinGradlePlugin(input, 'Kotlin cleanup');
  assert.match(result, /def kotlinVersion/);
  assert.match(result, /println kotlinVersion/);
  assert.doesNotMatch(result, /kotlin-gradle-plugin/);
});


test('removeKotlinGradlePlugin tolerates a wrapped conditional classpath', () => {
  const { removeKotlinGradlePlugin } = require('./expoAndroidGradleFixes.js');
  const source = `dependencies {
  classpath(
    kotlinVersion ? "org.jetbrains.kotlin:kotlin-gradle-plugin:$kotlinVersion"
      : "org.jetbrains.kotlin:kotlin-gradle-plugin"
  )
  classpath('com.android.tools.build:gradle')
}`;
  const result = removeKotlinGradlePlugin(source, 'wrapped Kotlin classpath');
  assert.doesNotMatch(result, /org\.jetbrains\.kotlin:kotlin-gradle-plugin/);
  assert.match(result, /com\.android\.tools\.build:gradle/);
});
