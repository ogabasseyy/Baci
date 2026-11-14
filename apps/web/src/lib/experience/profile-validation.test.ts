import { afterEach, expect, it, vi } from 'vitest';
import type { ExperienceCompositionSettings } from './compose-runtime';
import { validateExperienceProfile } from './profile-validation';

function settings() {
  return {
    profile: 'local-synthetic',
    hostOrigin: 'http://127.0.0.1:43174',
    runtimeBase: 'http://localhost:43175',
    owner: {
      approval: {
        loadLifecycle: vi.fn(),
        confirmPublication: vi.fn(),
        confirmModeExit: vi.fn(),
      },
    },
    dispatcher: { finalizeBuild: vi.fn(), preview: vi.fn() },
  } as unknown as ExperienceCompositionSettings;
}
afterEach(() => vi.unstubAllEnvs());
it('admits a complete loopback-only local runtime outside production', () => {
  vi.stubEnv('NODE_ENV', 'test');
  expect(() => validateExperienceProfile(settings())).not.toThrow();
});
it('denies local profiles in production and unknown profiles', () => {
  vi.stubEnv('NODE_ENV', 'production');
  expect(() => validateExperienceProfile(settings())).toThrow(
    'PROFILE_DISABLED'
  );
  expect(() =>
    validateExperienceProfile({ ...settings(), profile: 'unknown' } as never)
  ).toThrow('PROFILE_DISABLED');
});
it.each([
  'hostOrigin',
  'runtimeBase',
] as const)('rejects non-loopback and non-origin local %s values', (key) => {
  vi.stubEnv('NODE_ENV', 'test');
  for (const value of [
    'http://example.com',
    'https://localhost',
    'http://localhost/path',
    'http://user@localhost',
    'http://localhost/?x=1',
    'http://localhost/#hash',
  ]) {
    expect(() =>
      validateExperienceProfile({ ...settings(), [key]: value })
    ).toThrow('LOCAL_ORIGIN_REQUIRED');
  }
});
it('admits isolated HTTPS production sites and rejects shared sites or insecure origins', () => {
  vi.stubEnv('NODE_ENV', 'production');
  const production = {
    ...settings(),
    profile: 'production' as const,
    hostOrigin: 'https://usebaci.com',
    runtimeBase: 'https://runtime.example.org',
  };
  expect(() => validateExperienceProfile(production)).not.toThrow();
  expect(() =>
    validateExperienceProfile({
      ...production,
      runtimeBase: 'https://runtime.usebaci.com',
    })
  ).toThrow('EXECUTION_SITE_MUST_BE_ISOLATED');
  expect(() =>
    validateExperienceProfile({
      ...production,
      runtimeBase: 'http://runtime.example.org',
    })
  ).toThrow('INVALID_PRODUCTION_ORIGIN');
});
it('requires every lifecycle confirmation and build/preview port', () => {
  vi.stubEnv('NODE_ENV', 'test');
  for (const key of [
    'loadLifecycle',
    'confirmPublication',
    'confirmModeExit',
  ] as const) {
    const s = settings();
    const approval = { ...s.owner.approval, [key]: undefined };
    expect(() =>
      validateExperienceProfile({
        ...s,
        owner: { ...s.owner, approval },
      } as never)
    ).toThrow('INCOMPLETE_RUNTIME');
  }
  for (const key of ['finalizeBuild', 'preview'] as const) {
    const s = settings();
    expect(() =>
      validateExperienceProfile({
        ...s,
        dispatcher: { ...s.dispatcher, [key]: undefined },
      } as never)
    ).toThrow('INCOMPLETE_RUNTIME');
  }
});
