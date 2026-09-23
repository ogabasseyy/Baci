import { readFileSync } from 'node:fs';
import path from 'node:path';

const releaseWorkflows = [
  {
    bannerUnitSecret: 'EXPO_PUBLIC_QUIZ_ADMOB_ANDROID_BANNER_UNIT_ID',
    buildPhases: [
      'Generate Android project via Expo prebuild',
      'Build Android App Bundle (storefront)',
    ],
    name: 'Android',
    oppositeBannerUnitSecret: 'EXPO_PUBLIC_QUIZ_ADMOB_IOS_BANNER_UNIT_ID',
    rewardedUnitSecrets: [
      'EXPO_PUBLIC_QUIZ_ADMOB_ANDROID_REWARDED_UNIT_ID',
      'EXPO_PUBLIC_QUIZ_ADMOB_IOS_REWARDED_UNIT_ID',
    ],
    path: '../../../../.github/workflows/android-storefront-release.yml',
    platform: 'android',
  },
  {
    bannerUnitSecret: 'EXPO_PUBLIC_QUIZ_ADMOB_IOS_BANNER_UNIT_ID',
    buildPhases: ['Generate iOS project via Expo prebuild', 'Fastlane release'],
    name: 'iOS',
    oppositeBannerUnitSecret: 'EXPO_PUBLIC_QUIZ_ADMOB_ANDROID_BANNER_UNIT_ID',
    rewardedUnitSecrets: [
      'EXPO_PUBLIC_QUIZ_ADMOB_ANDROID_REWARDED_UNIT_ID',
      'EXPO_PUBLIC_QUIZ_ADMOB_IOS_REWARDED_UNIT_ID',
    ],
    path: '../../../../.github/workflows/ios-storefront-release.yml',
    platform: 'ios',
  },
] as const;

function extractStep(workflowSource: string, stepName: string): string {
  const marker = `      - name: ${stepName}`;
  const start = workflowSource.indexOf(marker);
  if (start === -1) throw new Error(`Missing workflow step: ${stepName}`);

  const end = workflowSource.indexOf('\n      - name:', start + marker.length);
  return workflowSource.slice(start, end === -1 ? undefined : end);
}

function resolveQuizAdsEnabled(
  stepSource: string,
  secrets: Readonly<Record<string, string>>
): string {
  const activeSecret = stepSource.match(
    /EXPO_PUBLIC_QUIZ_ADS_ENABLED:\s*\$\{\{\s*secrets\.([A-Z0-9_]+)\s*!=\s*''\s*&&\s*'true'\s*\|\|\s*'false'\s*\}\}/
  )?.[1];
  if (!activeSecret) throw new Error('Missing quiz ads conditional');

  return secrets[activeSecret] ? 'true' : 'false';
}

describe('quiz ads in storefront release workflows', () => {
  it.each(
    releaseWorkflows
  )('enables quiz ads in each $name build phase only when its banner unit is configured', ({
    bannerUnitSecret,
    buildPhases,
    oppositeBannerUnitSecret,
    path: workflowPath,
    platform,
    rewardedUnitSecrets,
  }) => {
    const workflowSource = readFileSync(
      path.resolve(__dirname, workflowPath),
      'utf8'
    );
    for (const buildPhase of buildPhases) {
      const stepSource = extractStep(workflowSource, buildPhase);

      expect(
        resolveQuizAdsEnabled(stepSource, { [bannerUnitSecret]: 'configured' })
      ).toBe('true');
      expect(resolveQuizAdsEnabled(stepSource, {})).toBe('false');
      expect(
        resolveQuizAdsEnabled(stepSource, {
          [oppositeBannerUnitSecret]: 'configured',
        })
      ).toBe('false');
      for (const rewardedUnitSecret of rewardedUnitSecrets) {
        expect(stepSource).toMatch(
          new RegExp(
            `${rewardedUnitSecret}:\\s*\\$\\{\\{\\s*secrets\\.${rewardedUnitSecret}\\s*\\}\\}`
          )
        );
      }
    }

    expect(workflowSource).not.toContain(
      "EXPO_PUBLIC_QUIZ_ADS_ENABLED: 'true'"
    );
    expect(
      workflowSource.match(
        /^\s*BACI_MOBILE_BUILD_PLATFORM:\s*([a-z]+)\s*$/m
      )?.[1]
    ).toBe(platform);
  });
});
