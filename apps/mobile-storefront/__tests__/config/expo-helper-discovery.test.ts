import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from '@jest/globals';

const ROOT = path.resolve(__dirname, '../..');

describe('Expo helper discovery', () => {
  it('loads nested app config helpers when Node type stripping is disabled', () => {
    const configSource = readFileSync(
      path.join(ROOT, 'app.config.ts'),
      'utf-8'
    );
    // Split-config indirection: app.config.ts now delegates to the
    // production builder, which loads the nested helpers relatively
    // (ES imports in the .ts builder, CJS require in the plain-CJS
    // .js builder). Follow the delegation so the no-type-stripping
    // pin still covers the helpers actually loaded in production.
    const builderMatch = configSource.match(/require\('(\.\/config\/[^']+)'\)/);
    const builderSource = builderMatch
      ? readFileSync(path.join(ROOT, builderMatch[1]), 'utf-8')
      : '';
    const helperPattern =
      'android-intent-filters|expo-plugins|resolve-update-channel|sentry-expo-config|sentry-required-environment|tiktok-constants';
    const helperPaths = [
      ...configSource.matchAll(
        new RegExp(
          `require\\('(\\.\\/config\\/(?:${helperPattern})[^']*)'\\)`,
          'g'
        )
      ),
    ].map((match) => match[1]);
    const builderHelperPaths = [
      ...builderSource.matchAll(
        new RegExp(
          `(?:from\\s+'|require\\(')(\\.\\/(?:${helperPattern})[^']*)`,
          'g'
        )
      ),
    ].map((match) => `./config/${match[1].slice(2)}`);
    const allHelperPaths = [...helperPaths, ...builderHelperPaths];

    expect(allHelperPaths).toHaveLength(6);

    const result = spawnSync(
      process.execPath,
      [
        '--no-experimental-strip-types',
        '-e',
        `for (const helperPath of ${JSON.stringify(allHelperPaths)}) require(helperPath);`,
      ],
      {
        cwd: ROOT,
        encoding: 'utf8',
      }
    );

    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  });
});
