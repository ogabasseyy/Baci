import { expect, it, vi } from 'vitest';

const f = vi.hoisted(() => ({
  recorder: vi.fn(),
  captureService: vi.fn(),
  runner: vi.fn(),
  capture: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('../../tools/experience-verifier/capture-recorder', () => ({
  createVerifierCaptureRecorder: f.recorder,
}));
vi.mock('@/lib/experience/private-capture-service', () => ({
  createPrivateExperienceCapture: f.captureService,
}));
vi.mock('../../tools/experience-runner/runner-transport', () => ({
  createRunnerExecutor: f.runner,
}));
vi.mock('../../tools/experience-runner/capture-route', () => ({
  captureExperience: f.capture,
}));

import { createVerifierCaptureWorker } from '../../tools/experience-verifier/capture-worker';

it('uses the restricted recorder and a fixed runner to produce evidence internally', async () => {
  const record = vi.fn();
  const execute = vi.fn();
  const perform = vi.fn();
  f.recorder.mockResolvedValueOnce(record);
  f.runner.mockReturnValueOnce(execute);
  f.captureService.mockReturnValueOnce(perform);
  const settings = {
    pool: {},
    hostOrigin: 'https://shop.synthetic.test',
    previewOrigin: 'https://builder.synthetic.test',
    bootstrap: vi.fn(),
    runner: {
      endpoint: 'https://runner.runtime.test/v1/execute',
      key: new Uint8Array(32),
      toolchainDigest: 'a'.repeat(64),
    },
  } as unknown as Parameters<typeof createVerifierCaptureWorker>[0];
  expect(await createVerifierCaptureWorker(settings)).toBe(perform);
  expect(f.recorder).toHaveBeenCalledWith(settings.pool);
  expect(f.runner).toHaveBeenCalledWith({ ...settings.runner, lane: 'owner' });
  const config = f.captureService.mock.calls.at(-1)?.[0];
  expect(config.record).toBe(record);
  expect(config.profile).toBe('production');
  expect(config.maxPendingCaptures).toBe(128);
  const input = { synthetic: true };
  await config.capture(input);
  expect(f.capture).toHaveBeenCalledWith(input, execute);
});

it('does not install a capture operation when the verifier role is unsafe', async () => {
  f.captureService.mockClear();
  f.recorder.mockRejectedValueOnce(Error('UNSAFE_VERIFIER_DATABASE_SESSION'));
  await expect(createVerifierCaptureWorker({} as never)).rejects.toThrow(
    'UNSAFE_VERIFIER_DATABASE_SESSION'
  );
  expect(f.captureService).not.toHaveBeenCalled();
});
