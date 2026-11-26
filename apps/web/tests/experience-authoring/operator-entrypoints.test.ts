import { expect, it, vi } from 'vitest';

const { readConfig, start } = vi.hoisted(() => ({
  readConfig: vi.fn(),
  start: vi.fn(),
}));
vi.mock('../../tools/builder-auth/private-config-file', () => ({
  readPrivateAuthConfig: readConfig,
}));
vi.mock('../../tools/builder-auth/production-entry.ts', () => ({
  launchProductionAuthFromFile: readConfig,
}));
vi.mock('../../tools/builder-auth/production-service.ts', () => ({
  startProductionAuthBroker: start,
}));
vi.mock('../../tools/builder-production/auth-qualification.ts', () => ({
  startAuthQualification: start,
}));
vi.mock('../../tools/builder-production/production-start', () => ({
  startProductionBuilder: start,
}));
vi.mock('../../tools/experience-runner/production-start', () => ({
  startProductionRunner: start,
}));
vi.mock('../../tools/experience-verifier/production-start', () => ({
  startProductionVerifier: start,
}));

it.each([
  {
    name: 'auth qualification',
    load: () =>
      import('../../tools/builder-production/auth-qualification-main'),
    error: 'Baci auth qualification could not start.\n',
  },
  {
    name: 'builder',
    load: () => import('../../tools/builder-production/production-main'),
    error: 'Baci builder startup failed (identity).\n',
  },
  {
    name: 'runner',
    load: () => import('../../tools/experience-runner/production-main'),
    error: 'Baci runner could not start.\n',
  },
  {
    name: 'verifier',
    load: () => import('../../tools/experience-verifier/production-main'),
    error: 'Baci verifier could not start.\n',
  },
])('rejects the $name service before reading config when invoked as root', async ({
  load,
  error,
}) => {
  const exitCode = process.exitCode;
  const identity = vi.spyOn(process, 'getuid').mockReturnValue(0);
  const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
  try {
    await load();
    expect(process.exitCode).toBe(1);
    expect(stderr).toHaveBeenCalledExactlyOnceWith(error);
    expect(readConfig).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
  } finally {
    process.exitCode = exitCode;
    stderr.mockRestore();
    identity.mockRestore();
  }
});
