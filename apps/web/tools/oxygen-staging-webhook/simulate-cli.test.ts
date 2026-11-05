// @vitest-environment node
import { expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  mkdtemp: vi.fn().mockResolvedValue('/tmp/oxygen-simulation-fixture'),
  simulate: vi.fn().mockResolvedValue({ accepted: 2 }),
}));
vi.mock('node:fs/promises', () => ({
  mkdir: mocks.mkdir,
  mkdtemp: mocks.mkdtemp,
}));
vi.mock('./simulate', () => ({ simulateStagingCallbacks: mocks.simulate }));
it('runs the simulation in a private temporary evidence directory', async () => {
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  await import('./simulate-cli');
  expect(mocks.mkdir).toHaveBeenCalledWith(
    expect.stringContaining('staging-webhook/simulations'),
    { recursive: true, mode: 0o700 }
  );
  expect(mocks.mkdtemp).toHaveBeenCalledWith(
    expect.stringContaining('sample-')
  );
  expect(mocks.simulate).toHaveBeenCalledExactlyOnceWith(
    '/tmp/oxygen-simulation-fixture'
  );
  expect(log).toHaveBeenCalledWith(
    expect.stringContaining('oxygen-simulation-fixture')
  );
  log.mockRestore();
});
