import { randomUUID } from 'node:crypto';
import {
  makeSandboxInvocation,
  type SandboxPrerequisites,
  sandboxPrerequisites,
} from './sandbox-policy';
export interface SandboxJob {
  kind: 'build' | 'capture' | 'probe';
  payload: Record<string, unknown>;
}
export interface SandboxInvocation {
  args: string[];
  env: Record<string, string>;
  timeoutMs: number;
  maxOutputBytes: number;
  name: string;
  input: string;
}
export interface SupervisorDeps {
  image: string;
  host: Omit<SandboxPrerequisites, 'image'>;
  execute(
    invocation: SandboxInvocation
  ): Promise<{ code: number; stdout: string; wallMs: number }>;
}
/** The child receives data only, never owner authority or an output/approval ticket. */
export async function runIsolatedJob(job: SandboxJob, deps: SupervisorDeps) {
  const blockers = sandboxPrerequisites({ ...deps.host, image: deps.image });
  if (blockers.length) throw new Error(blockers.join(','));
  const input = JSON.stringify(job);
  if (Buffer.byteLength(input) > 8 * 1024 * 1024)
    throw new Error('Input budget exceeded');
  const policy = makeSandboxInvocation(
    job.kind === 'capture' ? 'capture' : 'build',
    deps.image
  );
  const name = `baci-experience-${randomUUID()}`;
  const args = [policy.args[0], `--name=${name}`, ...policy.args.slice(1)];
  // Probe uses the same constrained entry point, never a caller-selected command.
  args[args.length - 1] = job.kind;
  const output = await deps.execute({ ...policy, args, name, input });
  if (output.code !== 0)
    throw new Error(`Isolated job failed (${output.code})`);
  if (Buffer.byteLength(output.stdout) > policy.maxOutputBytes)
    throw new Error('Output budget exceeded');
  const result: unknown = JSON.parse(output.stdout);
  if (!result || typeof result !== 'object' || Array.isArray(result))
    throw new Error('Invalid worker output');
  // Candidate output only; later independent verification/finalization grants authority.
  return { result, wallMs: output.wallMs, image: deps.image };
}
