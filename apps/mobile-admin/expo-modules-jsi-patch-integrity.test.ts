import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

const jsiPackageJsonPath = require.resolve('expo-modules-jsi/package.json');
const jsiRoot = dirname(jsiPackageJsonPath);
const runtimeSchedulerPath = join(
  jsiRoot,
  'apple/Sources/ExpoModulesJSI-Cxx/include/RuntimeScheduler.h'
);

describe('bugfix: expo-modules-jsi Xcode 26.2 RuntimeScheduler archive failure', () => {
  it('keeps expo-modules-jsi pinned to the patched 57.0.5 archive', () => {
    const pkg = JSON.parse(readFileSync(jsiPackageJsonPath, 'utf8')) as {
      version?: string;
    };
    expect(pkg.version).toBe('57.0.5');
  });

  it('does not annotate RuntimeScheduler constructors with SWIFT_RETURNS_RETAINED', () => {
    expect(existsSync(runtimeSchedulerPath)).toBe(true);
    const source = readFileSync(runtimeSchedulerPath, 'utf8');

    expect(source).toContain(
      'RuntimeScheduler(void *scheduler, ScheduleFn fn) noexcept'
    );
    expect(source).not.toMatch(/SWIFT_RETURNS_RETAINED\s+RuntimeScheduler/);
  });
});
