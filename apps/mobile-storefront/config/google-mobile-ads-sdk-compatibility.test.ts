import { readFileSync } from 'node:fs';
import path from 'node:path';

interface PackageManifest {
  dependencies?: Record<string, string>;
  sdkVersions?: {
    android?: {
      googleMobileAds?: string;
    };
  };
  version?: string;
}

function readManifest(manifestPath: string): PackageManifest {
  return JSON.parse(readFileSync(manifestPath, 'utf8')) as PackageManifest;
}

describe('Google Mobile Ads Android build compatibility', () => {
  it('pins the wrapper whose Android SDK compiles with React Native Kotlin 2.1', () => {
    const projectManifest = readManifest(
      path.resolve(__dirname, '..', 'package.json')
    );
    const installedManifest = readManifest(
      require.resolve('react-native-google-mobile-ads/package.json')
    );

    expect(
      projectManifest.dependencies?.['react-native-google-mobile-ads']
    ).toBe('16.3.4');
    expect(installedManifest.version).toBe('16.3.4');
    expect(installedManifest.sdkVersions?.android?.googleMobileAds).toBe(
      '25.0.0'
    );
  });
});
