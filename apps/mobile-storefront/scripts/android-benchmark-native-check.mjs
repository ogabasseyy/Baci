import { join, resolve } from 'node:path';

export function validateBenchmarkApk({ appDir, artifactPath, execute }) {
  const repositoryDir = resolve(appDir, '../..');
  execute(
    'Validating benchmark APK native libraries',
    process.execPath,
    [
      join(repositoryDir, '.github/scripts/android-native-library-check.mjs'),
      artifactPath,
      '--abis',
      'arm64-v8a',
    ],
    appDir
  );
}
