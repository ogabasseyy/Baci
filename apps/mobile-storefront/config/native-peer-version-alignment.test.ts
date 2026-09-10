import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from '@jest/globals';

type MobilePackage = {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
};

type NativePeerPackage = {
  peerDependencies: Record<string, string>;
};

const workspaceRoot = join(__dirname, '../../..');
const readMobilePackage = (relativePath: string): MobilePackage =>
  JSON.parse(
    readFileSync(join(workspaceRoot, relativePath, 'package.json'), 'utf8')
  ) as MobilePackage;

describe('bugfix: hoisted native peer versions', () => {
  it('keeps Expo and React Native aligned across linked mobile packages', () => {
    const storefront = readMobilePackage('apps/mobile-storefront');
    const admin = readMobilePackage('apps/mobile-admin');
    const tiktokBusiness = readMobilePackage(
      'packages/tiktok-business'
    ) as unknown as NativePeerPackage;

    expect(storefront.dependencies['react-native-mmkv']).toBe(
      admin.dependencies['react-native-mmkv']
    );
    expect(storefront.dependencies.expo).toBe(admin.dependencies.expo);
    expect(storefront.dependencies['react-native']).toBe(
      admin.dependencies['react-native']
    );
    expect(tiktokBusiness.peerDependencies.expo).toBe(
      `^${storefront.dependencies.expo.slice(1)}`
    );
    expect(tiktokBusiness.peerDependencies['react-native']).toBe(
      storefront.dependencies['react-native']
    );
    expect(storefront.devDependencies['@react-native/metro-config']).toBe(
      admin.devDependencies['@react-native/metro-config']
    );
    expect(storefront.devDependencies['@react-native/jest-preset']).toBe(
      storefront.dependencies['react-native']
    );
    expect(storefront.devDependencies['jest-expo']).toBe('57.0.4');
  });

  it('resolves one MMKV native peer graph in the workspace lockfile', () => {
    const lockfile = readFileSync(
      join(workspaceRoot, 'pnpm-lock.yaml'),
      'utf8'
    );
    // pnpm may emit either `  pkg@ver(...):` or the long-key form
    // `  ? pkg@ver(...)\n  : dependencies:` — both are a single snapshot.
    const mmkvSnapshots = lockfile.match(
      /^ {2}(?:\? )?react-native-mmkv@4\.3\.1\(.+$/gm
    );

    expect(mmkvSnapshots).toHaveLength(1);
    expect(mmkvSnapshots?.[0]).toContain('react-native@0.86.2');
  });
});
