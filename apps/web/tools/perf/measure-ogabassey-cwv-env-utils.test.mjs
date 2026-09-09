import { describe, expect, it } from 'vitest';
import { ogabasseyCwvEnv } from './measure-ogabassey-cwv-env-utils.mjs';

const {
  getWrapperDefaultEnvKeys,
  isFalseyEnvValue,
  isTruthyEnvValue,
  loadEnvFile,
  loadOgaBasseyCwvEnvFiles,
  setDefaultEnv,
} = ogabasseyCwvEnv;

describe('env flag helpers', () => {
  it('normalizes common truthy and falsey env values', () => {
    expect(isTruthyEnvValue('YES')).toBe(true);
    expect(isTruthyEnvValue(' on ')).toBe(true);
    expect(isFalseyEnvValue('false')).toBe(true);
    expect(isFalseyEnvValue('off')).toBe(true);
  });
});

describe('loadEnvFile', () => {
  it('loads quoted env values without overwriting existing keys', async () => {
    const env = { EXISTING: 'kept' };
    const loaded = await loadEnvFile('/tmp/.env.local', {
      env,
      readText: async () =>
        [
          '# ignored',
          'DEBUGBEAR_PROJECT_ID="101919"',
          "OGABASSEY_CWV_PSI='0'",
          'EXISTING=replaced',
        ].join('\n'),
    });

    expect(loaded).toBe(true);
    expect(env).toEqual({
      DEBUGBEAR_PROJECT_ID: '101919',
      EXISTING: 'kept',
      OGABASSEY_CWV_PSI: '0',
    });
  });

  it('strips inline comments outside quoted env values', async () => {
    const env = {};
    const loaded = await loadEnvFile('/tmp/.env.local', {
      env,
      readText: async () =>
        [
          'OGABASSEY_CWV_PSI=0 # offline',
          'DEBUGBEAR_API_KEY=project-key # account project key',
          'QUOTED_HASH="value # not a comment" # trailing comment',
        ].join('\n'),
    });

    expect(loaded).toBe(true);
    expect(env).toEqual({
      DEBUGBEAR_API_KEY: 'project-key',
      OGABASSEY_CWV_PSI: '0',
      QUOTED_HASH: 'value # not a comment',
    });
  });

  it('can override root env-file values without replacing shell-owned keys', async () => {
    const shellOwned = new Set(['DEBUGBEAR_API_KEY']);
    const env = {
      DEBUGBEAR_API_KEY: 'shell-key',
      DEBUGBEAR_PROJECT_ID: 'root-project',
    };
    const loaded = await loadEnvFile('/apps/web/.env.local', {
      env,
      override: (key) => !shellOwned.has(key),
      readText: async () =>
        ['DEBUGBEAR_API_KEY=app-key', 'DEBUGBEAR_PROJECT_ID=app-project'].join(
          '\n'
        ),
    });

    expect(loaded).toBe(true);
    expect(env).toEqual({
      DEBUGBEAR_API_KEY: 'shell-key',
      DEBUGBEAR_PROJECT_ID: 'app-project',
    });
  });

  it('returns false when the env file is missing', async () => {
    await expect(
      loadEnvFile('/tmp/missing.env', {
        env: {},
        readText: () => {
          const error = new Error('missing');
          error.code = 'ENOENT';
          throw error;
        },
      })
    ).resolves.toBe(false);
  });
});

describe('setDefaultEnv', () => {
  it('tracks wrapper defaults so env files can override generated defaults', () => {
    const env = {};

    setDefaultEnv(env, 'OGABASSEY_PDP_LCP_URL', 'https://fallback.test/pdp', {
      track: true,
    });

    expect(env.OGABASSEY_PDP_LCP_URL).toBe('https://fallback.test/pdp');
    expect(getWrapperDefaultEnvKeys(env).has('OGABASSEY_PDP_LCP_URL')).toBe(
      true
    );
  });
});

describe('loadOgaBasseyCwvEnvFiles', () => {
  it('lets app env values override wrapper defaults without replacing shell keys', async () => {
    const calls = [];
    const env = {
      DEBUGBEAR_API_KEY: 'shell-key',
      OGABASSEY_CWV_WRAPPER_DEFAULT_KEYS: 'OGABASSEY_PDP_LCP_URL',
      OGABASSEY_PDP_LCP_URL: 'wrapper-pdp',
    };
    await loadOgaBasseyCwvEnvFiles({
      appRoot: '/repo/apps/web',
      env,
      loadEnvFileImpl: (path, options) => {
        calls.push(path);
        if (path.endsWith('/apps/web/.env.local')) {
          options.override('OGABASSEY_PDP_LCP_URL');
          env.OGABASSEY_PDP_LCP_URL = 'app-pdp';
          if (options.override('DEBUGBEAR_API_KEY')) {
            env.DEBUGBEAR_API_KEY = 'app-key';
          }
        }
        return true;
      },
      repoRoot: '/repo',
    });

    expect(calls).toEqual(['/repo/.env.local', '/repo/apps/web/.env.local']);
    expect(env.OGABASSEY_PDP_LCP_URL).toBe('app-pdp');
    expect(env.DEBUGBEAR_API_KEY).toBe('shell-key');
  });
});
