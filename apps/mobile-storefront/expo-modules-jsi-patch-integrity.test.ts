import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from '@jest/globals';

// Patch-integrity guards for the Expo Modules JSI native sources.
//
// Xcode 26.2 (the CI macos-26 image) cannot resolve `abs` in this module's
// Date guard: C++ interop pulls the C stdlib `abs` overloads into scope next
// to Swift's, so `abs(milliseconds)` is rejected as "ambiguous use of 'abs'".
// That archive-failed every storefront iOS release since #3139. The patch
// rewrites the guard to `Double.magnitude` — a property access with no
// overload set, semantically identical here.
//
// Without this test the failure is invisible until the release archive: a
// patch refresh or a dependency re-resolution that drops the patch or
// reintroduces a bare `abs(...)` call would pass every JS-side gate and only
// blow up in Xcode. This regression test reproduces the exact failing
// condition (the ambiguous `abs(...)` form) at the JS layer so it is caught in
// CI instead.

const jsiPackageJsonPath = require.resolve('expo-modules-jsi/package.json');
const jsiRoot = dirname(jsiPackageJsonPath);
const dateGuardPath = join(
  jsiRoot,
  'apple/Sources/ExpoModulesJSI/Coding/JavaScriptCodable+Date.swift'
);

describe('bugfix: expo-modules-jsi Xcode 26.2 abs-ambiguity archive failure', () => {
  it('keeps the resolved Expo 57 package patched or on the upstream fix', () => {
    // Expo 57.0.15 resolves the upstream-fixed 57.0.5 package.
    const pkg = JSON.parse(readFileSync(jsiPackageJsonPath, 'utf8')) as {
      version?: string;
    };
    expect(['57.0.3', '57.0.5']).toContain(pkg.version);
  });

  it('applies the Double.magnitude guard and never the ambiguous abs() call', () => {
    expect(existsSync(dateGuardPath)).toBe(true);
    const source = readFileSync(dateGuardPath, 'utf8');

    // The fix must be applied...
    expect(source).toContain('milliseconds.magnitude');
    // ...and the form that fails to compile under Xcode 26.2 must never come
    // back (neither the original inline `abs(...) <= ...` nor an `abs(...)`
    // local — both were ambiguous under C++ interop).
    expect(source).not.toMatch(/\babs\s*\(/);
  });

  it('keeps RuntimeScheduler constructors compatible with Swift 6 C++ interop', () => {
    const runtimeSchedulerPath = join(
      jsiRoot,
      'apple/Sources/ExpoModulesJSI-Cxx/include/RuntimeScheduler.h'
    );
    expect(existsSync(runtimeSchedulerPath)).toBe(true);
    const source = readFileSync(runtimeSchedulerPath, 'utf8');

    expect(source).not.toMatch(
      /SWIFT_RETURNS_RETAINED RuntimeScheduler(?:\(|\s)/
    );
    expect(source).toContain(
      '} SWIFT_SHARED_REFERENCE(retainRuntimeScheduler, releaseRuntimeScheduler);'
    );
  });

  it('keeps the storefront React Native 0.86.2 platform patch registered', () => {
    const workspaceConfig = readFileSync(
      join(__dirname, '../../pnpm-workspace.yaml'),
      'utf8'
    );
    const lockfile = readFileSync(
      join(__dirname, '../../pnpm-lock.yaml'),
      'utf8'
    );
    const reactNativePatchPath = join(
      __dirname,
      '../../patches/react-native@0.86.2.patch'
    );
    const reactNativePatchHash = lockfile.match(
      /^ {2}react-native@0\.86\.2: ([a-f0-9]{64})$/m
    )?.[1];
    const storefrontImporterStart = lockfile.indexOf(
      '  apps/mobile-storefront:'
    );
    const storefrontImporterEnd = lockfile.indexOf(
      '\n  apps/web:',
      storefrontImporterStart
    );

    expect(workspaceConfig).toContain(
      'react-native@0.86.2: patches/react-native@0.86.2.patch'
    );
    expect(reactNativePatchHash).toMatch(/^[a-f0-9]{64}$/);
    expect(
      lockfile.slice(storefrontImporterStart, storefrontImporterEnd)
    ).toContain(`version: 0.86.2(patch_hash=${reactNativePatchHash})`);
    expect(existsSync(reactNativePatchPath)).toBe(true);
    expect(readFileSync(reactNativePatchPath, 'utf8')).toContain(
      'StatusBarModule.kt'
    );

    const expoJsiPatchHash = lockfile.match(
      /^ {2}expo-modules-jsi@57\.0\.5: ([a-f0-9]{64})$/m
    )?.[1];
    expect(workspaceConfig).toContain(
      'expo-modules-jsi@57.0.5: "patches/expo-modules-jsi@57.0.5.patch"'
    );
    expect(expoJsiPatchHash).toMatch(/^[a-f0-9]{64}$/);
    expect(lockfile).toContain(
      `expo-modules-jsi: 57.0.5(patch_hash=${expoJsiPatchHash})`
    );
    expect(
      existsSync(join(__dirname, '../../patches/expo-modules-jsi@57.0.5.patch'))
    ).toBe(true);
  });
});
