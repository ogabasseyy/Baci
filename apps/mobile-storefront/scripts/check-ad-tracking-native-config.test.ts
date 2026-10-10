import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SCRIPT_PATH = path.join(__dirname, 'check-ad-tracking-native-config.mjs');
const PROJECT_ROOT = path.resolve(__dirname, '..');
const APP_CONFIG_PATH = path.join(PROJECT_ROOT, 'app.config.ts');
const INFO_PLIST_PATH = path.join(
  PROJECT_ROOT,
  'ios',
  'Ogabassey',
  'Info.plist'
);
const XCODE_PROJECT_PATH = path.join(
  PROJECT_ROOT,
  'ios',
  'Ogabassey.xcodeproj',
  'project.pbxproj'
);
const FASTFILE_PATH = path.join(PROJECT_ROOT, 'fastlane', 'Fastfile');
const PRODUCTION_CONFIG_PATH = path.join(
  PROJECT_ROOT,
  'config',
  'development-storefront-expo-config-production.ts'
);

function copyRequiredProjectFiles(tempRoot: string) {
  mkdirSync(path.join(tempRoot, 'ios', 'Ogabassey.xcodeproj'), {
    recursive: true,
  });
  mkdirSync(path.join(tempRoot, 'ios', 'Ogabassey'), { recursive: true });
  mkdirSync(path.join(tempRoot, 'fastlane'), { recursive: true });
  mkdirSync(path.join(tempRoot, 'config'), { recursive: true });
  copyFileSync(APP_CONFIG_PATH, path.join(tempRoot, 'app.config.ts'));
  if (existsSync(PRODUCTION_CONFIG_PATH)) {
    copyFileSync(
      PRODUCTION_CONFIG_PATH,
      path.join(
        tempRoot,
        'config',
        'development-storefront-expo-config-production.ts'
      )
    );
  }
  copyFileSync(
    INFO_PLIST_PATH,
    path.join(tempRoot, 'ios', 'Ogabassey', 'Info.plist')
  );
  copyFileSync(
    XCODE_PROJECT_PATH,
    path.join(tempRoot, 'ios', 'Ogabassey.xcodeproj', 'project.pbxproj')
  );
  copyFileSync(FASTFILE_PATH, path.join(tempRoot, 'fastlane', 'Fastfile'));
}

function runNativeAdConfigCheck(projectRoot = PROJECT_ROOT) {
  return spawnSync(process.execPath, [SCRIPT_PATH, '--project-root', projectRoot], {
    encoding: 'utf8',
  });
}

function replaceRequired(
  source: string,
  target: string | RegExp,
  replacement: string
) {
  expect(source).toMatch(target);
  return source.replace(target, replacement);
}

describe('check-ad-tracking-native-config', () => {
  it('keeps the committed iOS ad-tracking plist in sync with app config', () => {
    const result = runNativeAdConfigCheck();

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('[ad-tracking-native-config] OK');
  });

  it('accepts double-quoted app config ad declarations on the same line', () => {
    const tempRoot = mkdtempSync(
      path.join(os.tmpdir(), 'baci-ad-tracking-config-')
    );
    try {
      copyRequiredProjectFiles(tempRoot);

      // Declarations live in the production config module on split-config
      // trees (app.config.ts is a dispatcher); rewrite quotes there.
      const splitConfig = existsSync(PRODUCTION_CONFIG_PATH);
      const declarationsPath = splitConfig
        ? PRODUCTION_CONFIG_PATH
        : APP_CONFIG_PATH;
      const tempDeclarationsPath = splitConfig
        ? path.join(
            tempRoot,
            'config',
            'development-storefront-expo-config-production.ts'
          )
        : path.join(tempRoot, 'app.config.ts');
      const appConfigSource = readFileSync(declarationsPath, 'utf8')
        .replace(
          /NSUserTrackingUsageDescription:\s*\n\s*'([^']+)'/,
          'NSUserTrackingUsageDescription: "$1"'
        )
        .replaceAll(
          /SKAdNetworkIdentifier:\s*'([^']+)'/g,
          'SKAdNetworkIdentifier: "$1"'
        );
      expect(appConfigSource).toContain('NSUserTrackingUsageDescription: "');
      expect(appConfigSource).toContain('SKAdNetworkIdentifier: "');
      writeFileSync(tempDeclarationsPath, appConfigSource);

      const result = runNativeAdConfigCheck(tempRoot);

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('[ad-tracking-native-config] OK');
    } finally {
      rmSync(tempRoot, { force: true, recursive: true });
    }
  });

  it('rejects a committed plist that omits the TikTok auto-init opt-out', () => {
    const tempRoot = mkdtempSync(
      path.join(os.tmpdir(), 'baci-ad-tracking-config-')
    );
    try {
      copyRequiredProjectFiles(tempRoot);
      const infoPlist = readFileSync(INFO_PLIST_PATH, 'utf8').replace(
        /\s*<key>BaciTikTokBusinessAutoInitialize<\/key>\s*<false\/>/,
        ''
      );
      writeFileSync(
        path.join(tempRoot, 'ios', 'Ogabassey', 'Info.plist'),
        infoPlist
      );

      const result = runNativeAdConfigCheck(tempRoot);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain(
        'BaciTikTokBusinessAutoInitialize: expected false, got undefined'
      );
    } finally {
      rmSync(tempRoot, { force: true, recursive: true });
    }
  });

  it('rejects release automation that omits ATT App Review notes', () => {
    const tempRoot = mkdtempSync(
      path.join(os.tmpdir(), 'baci-ad-tracking-config-')
    );
    try {
      copyRequiredProjectFiles(tempRoot);
      const fastfilePath = path.join(tempRoot, 'fastlane', 'Fastfile');
      const fastfile = replaceRequired(
        readFileSync(fastfilePath, 'utf8'),
        'update_app_review_notes!(review_notes_text, app_version: app_version)',
        ''
      );
      writeFileSync(fastfilePath, fastfile);

      const result = runNativeAdConfigCheck(tempRoot);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain(
        'Fastfile: submit lane must upload ATT App Review notes'
      );
    } finally {
      rmSync(tempRoot, { force: true, recursive: true });
    }
  });

  it('rejects release automation that reports IDFA use as false', () => {
    const tempRoot = mkdtempSync(
      path.join(os.tmpdir(), 'baci-ad-tracking-config-')
    );
    try {
      copyRequiredProjectFiles(tempRoot);
      const fastfilePath = path.join(tempRoot, 'fastlane', 'Fastfile');
      const fastfile = replaceRequired(
        readFileSync(fastfilePath, 'utf8'),
        'add_id_info_uses_idfa: true',
        'add_id_info_uses_idfa: false'
      );
      writeFileSync(fastfilePath, fastfile);

      const result = runNativeAdConfigCheck(tempRoot);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain(
        'Fastfile: add_id_info_uses_idfa must remain true'
      );
    } finally {
      rmSync(tempRoot, { force: true, recursive: true });
    }
  });

  it('rejects release automation without the default ATT review-note fallback', () => {
    const tempRoot = mkdtempSync(
      path.join(os.tmpdir(), 'baci-ad-tracking-config-')
    );
    try {
      copyRequiredProjectFiles(tempRoot);
      const fastfilePath = path.join(tempRoot, 'fastlane', 'Fastfile');
      const fastfile = replaceRequired(
        readFileSync(fastfilePath, 'utf8'),
        'review_notes_text = DEFAULT_ATT_REVIEW_NOTES if review_notes_text.empty?',
        ''
      );
      writeFileSync(fastfilePath, fastfile);

      const result = runNativeAdConfigCheck(tempRoot);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain(
        'Fastfile: submit lane must default empty IOS_REVIEW_NOTES to DEFAULT_ATT_REVIEW_NOTES'
      );
    } finally {
      rmSync(tempRoot, { force: true, recursive: true });
    }
  });

  it('rejects App Review notes updated outside the submit lane', () => {
    const tempRoot = mkdtempSync(
      path.join(os.tmpdir(), 'baci-ad-tracking-config-')
    );
    try {
      copyRequiredProjectFiles(tempRoot);
      const fastfilePath = path.join(tempRoot, 'fastlane', 'Fastfile');
      const reviewInformation =
        'update_app_review_notes!(review_notes_text, app_version: app_version)';
      const fastfile = replaceRequired(
        readFileSync(fastfilePath, 'utf8'),
        reviewInformation,
        ''
      )
        .replace(
          'lane :submit do',
          `${reviewInformation}\n  lane :submit do`
        );
      writeFileSync(fastfilePath, fastfile);

      const result = runNativeAdConfigCheck(tempRoot);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain(
        'Fastfile: submit lane must upload ATT App Review notes'
      );
    } finally {
      rmSync(tempRoot, { force: true, recursive: true });
    }
  });

  it('rejects metadata upload that could delete App Review attachments', () => {
    const tempRoot = mkdtempSync(
      path.join(os.tmpdir(), 'baci-ad-tracking-config-')
    );
    try {
      copyRequiredProjectFiles(tempRoot);
      const fastfilePath = path.join(tempRoot, 'fastlane', 'Fastfile');
      const fastfile = replaceRequired(
        readFileSync(fastfilePath, 'utf8'),
        'skip_metadata: true',
        'skip_metadata: false'
      );
      writeFileSync(fastfilePath, fastfile);

      const result = runNativeAdConfigCheck(tempRoot);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain(
        'skip_metadata must remain true so review-note updates preserve attachments'
      );
    } finally {
      rmSync(tempRoot, { force: true, recursive: true });
    }
  });

  it.each([
    {
      expected: 'submit lane must upload ATT App Review notes',
      target: 'update_app_review_notes!(review_notes_text, app_version: app_version)',
    },
    {
      expected: 'skip_metadata must remain true',
      target: 'skip_metadata: true',
    },
  ])('rejects required Fastfile configuration left only in a comment', ({ target, expected }) => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'baci-ad-tracking-config-'));
    try {
      copyRequiredProjectFiles(tempRoot);
      const fastfilePath = path.join(tempRoot, 'fastlane', 'Fastfile');
      const fastfile = replaceRequired(
        readFileSync(fastfilePath, 'utf8'),
        target,
        `# ${target}`
      );
      writeFileSync(fastfilePath, fastfile);

      const result = runNativeAdConfigCheck(tempRoot);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain(expected);
    } finally {
      rmSync(tempRoot, { force: true, recursive: true });
    }
  });
});
