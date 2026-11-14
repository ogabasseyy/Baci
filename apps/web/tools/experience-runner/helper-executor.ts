import { randomUUID } from 'node:crypto';
import type { LinuxRunnerCommand } from './linux-runner';
import type { QualificationKind } from './local-oci-executor';

const kinds = new Set<QualificationKind>([
  'compile',
  'capture',
  'performance',
  'checks',
  'prerender',
  'prerender-build',
]);
const helper = '/usr/local/libexec/baci-experience-helper';

/** Sends only a fixed job type and opaque payload to the root-owned helper. */
export async function runHelperQualification(
  kind: QualificationKind,
  payload: unknown,
  command: LinuxRunnerCommand
): Promise<{ output: unknown; wallMs: number; jobId: string }> {
  if (!kinds.has(kind)) throw Error('INVALID_RUNNER_KIND');
  const input = JSON.stringify(payload);
  if (typeof input !== 'string' || Buffer.byteLength(input) > 8 * 1024 * 1024)
    throw Error('Input budget');
  const jobId = `baci-experience-${randomUUID()}`;
  const call = (args: string[], data: string | undefined, timeout: number) =>
    command('/usr/bin/sudo', ['-n', helper, ...args], data, timeout);
  await call(['prepare', kind, jobId], undefined, 10000);
  const started = performance.now();
  let failure: { error: unknown } | undefined;
  let result: { output: unknown; wallMs: number; jobId: string } | undefined;
  try {
    const timeout = [
      'compile',
      'prerender',
      'prerender-build',
      'capture',
    ].includes(kind)
      ? 60000
      : 30000;
    const stdout = await call(['run', jobId], input, timeout);
    if (Buffer.byteLength(stdout) > 16 * 1024 * 1024)
      throw Error('Output budget');
    const output: unknown = JSON.parse(stdout);
    if (!output || typeof output !== 'object' || Array.isArray(output))
      throw Error('Invalid candidate output');
    result = { output, wallMs: Math.round(performance.now() - started), jobId };
  } catch (error) {
    failure = { error };
  }
  try {
    await call(['delete', jobId], undefined, 15000);
  } catch (error) {
    if (!failure) throw error;
    console.error('Runner job cleanup failed');
  }
  if (failure) throw failure.error;
  if (!result) throw Error('RUNNER_EXECUTION_FAILED');
  return result;
}
