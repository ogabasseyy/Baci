import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from '@jest/globals';

const ROOT = path.resolve(__dirname, '../..');

describe('native release workflow compliance', () => {
  it('does not restore a stale generated Pods tree for storefront releases', () => {
    const workflowSource = readFileSync(
      path.resolve(ROOT, '../../.github/workflows/ios-storefront-release.yml'),
      'utf8'
    );
    const cacheStart = workflowSource.indexOf('- name: Cache CocoaPods');
    const installStart = workflowSource.indexOf('- name: Install CocoaPods');
    const cacheSource = workflowSource.slice(cacheStart, installStart);

    expect(cacheStart).toBeGreaterThan(-1);
    expect(installStart).toBeGreaterThan(cacheStart);
    expect(cacheSource).toContain('~/Library/Caches/CocoaPods');
    expect(cacheSource).toContain('~/.cocoapods/repos');
    expect(cacheSource).not.toContain('apps/mobile-storefront/ios/Pods');
    expect(cacheSource).not.toContain('restore-keys:');
    expect(cacheSource).toContain("hashFiles('pnpm-lock.yaml'");
  });

  it('limits storefront production native compilation to the Play-supported ABI', () => {
    const workflowSource = readFileSync(
      path.resolve(ROOT, '../../.github/scripts/android-storefront-release.sh'),
      'utf8'
    );

    expect(workflowSource).toContain(
      'app:bundleRelease -PreactNativeArchitectures=arm64-v8a'
    );
  });
});
