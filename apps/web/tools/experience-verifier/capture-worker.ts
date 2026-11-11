import type { Pool } from 'pg';
import { createPrivateExperienceCapture } from '@/lib/experience/private-capture-service';
import { captureExperience } from '../experience-runner/capture-route';
import { createRunnerExecutor } from '../experience-runner/runner-transport';
import { createVerifierCaptureRecorder } from './capture-recorder';

type CaptureSettings = Parameters<typeof createPrivateExperienceCapture>[0];
type RunnerSettings = Parameters<typeof createRunnerExecutor>[0];

/** Trusted verifier process only; requests never carry screenshots or snapshots. */
export async function createVerifierCaptureWorker(settings: {
  pool: Pool;
  hostOrigin: string;
  previewOrigin: string;
  bootstrap: CaptureSettings['bootstrap'];
  runner: RunnerSettings;
}) {
  const record = await createVerifierCaptureRecorder(settings.pool);
  const execute = createRunnerExecutor({ ...settings.runner, lane: 'owner' });
  return createPrivateExperienceCapture({
    profile: 'production',
    hostOrigin: settings.hostOrigin,
    previewOrigin: settings.previewOrigin,
    bootstrap: settings.bootstrap,
    record,
    capture: (input) => captureExperience(input, execute),
  });
}
