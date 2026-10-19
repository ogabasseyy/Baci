import {
  copyFileSync,
  existsSync,
  mkdirSync,
} from 'node:fs';
import path from 'node:path';

export const PROJECT_ROOT = path.resolve(__dirname, '..');
export const APP_CONFIG_PATH = path.join(PROJECT_ROOT, 'app.config.ts');
export const INFO_PLIST_PATH = path.join(
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
export const PRODUCTION_CONFIG_PATH = path.join(
  PROJECT_ROOT,
  'config',
  'development-storefront-expo-config-production.js'
);

export function copyRequiredProjectFiles(tempRoot: string) {
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
        'development-storefront-expo-config-production.js'
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
