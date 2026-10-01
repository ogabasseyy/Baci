import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

type BabelConfig = {
  plugins?: unknown[];
};

const require = createRequire(import.meta.url);

describe('mobile-admin Babel configuration', () => {
  it('leaves React Compiler configuration to Expo SDK 57 app config', () => {
    const loadConfig = require('./babel.config.js') as (api: {
      cache: (value: boolean) => void;
    }) => BabelConfig;
    const config = loadConfig({ cache: () => undefined });

    expect(config.plugins).not.toContain('babel-plugin-react-compiler');
  });

  it('uses the supported worklets transform without experimental bundle mode', () => {
    const loadConfig = require('./babel.config.js') as (api: {
      cache: (value: boolean) => void;
    }) => BabelConfig;
    const config = loadConfig({ cache: () => undefined });

    expect(config.plugins).toContain('react-native-worklets/plugin');
    expect(config.plugins).not.toContainEqual([
      'react-native-worklets/plugin',
      expect.objectContaining({ bundleMode: true }),
    ]);
  });
});
