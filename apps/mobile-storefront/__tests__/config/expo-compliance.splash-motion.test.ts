import path from 'node:path';
import { describe, expect, it } from '@jest/globals';

const ROOT = path.resolve(__dirname, '../..');

describe('react-native-splash-motion configuration', () => {
  it('validates splash-motion fit option instead of falling back on typos', () => {
    const { resolveOptions } = require(
      path.resolve(
        path.dirname(
          require.resolve('react-native-splash-motion/package.json')
        ),
        'cli/core'
      )
    ) as {
      resolveOptions: (
        projectRoot: string,
        options: { source: string; fit?: unknown }
      ) => { fit: string };
    };

    expect(
      resolveOptions(ROOT, {
        source: './assets/splash-scene/native-splash.json',
      }).fit
    ).toBe('contain');
    expect(
      resolveOptions(ROOT, {
        source: './assets/splash-scene/native-splash.json',
        fit: 'cover',
      }).fit
    ).toBe('cover');
    expect(
      resolveOptions(ROOT, {
        source: './assets/splash-scene/native-splash.json',
        fit: 'contain',
      }).fit
    ).toBe('contain');

    for (const invalidFit of ['Cover', 'COVER', 'fill', '', null]) {
      expect(() =>
        resolveOptions(ROOT, {
          source: './assets/splash-scene/native-splash.json',
          fit: invalidFit,
        })
      ).toThrow(/Invalid fit/i);
    }
  });
});
