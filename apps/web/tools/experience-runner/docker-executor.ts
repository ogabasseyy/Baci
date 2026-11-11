import { execFile, spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import type { SandboxInvocation } from './sandbox-supervisor';
/** Fixed local context; no inherited provider environment, auth env, mounts or ports. */
export function executeDocker(
  invocation: SandboxInvocation
): Promise<{ code: number; stdout: string; wallMs: number }> {
  return new Promise((resolve, reject) => {
    const started = performance.now();
    const env = {
      PATH: process.env.PATH ?? '/usr/bin:/bin',
      HOME: process.env.HOME ?? '',
      LANG: invocation.env.LANG,
      TZ: invocation.env.TZ,
    };
    const child = spawn('docker', ['--context', 'colima', ...invocation.args], {
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const chunks: Buffer[] = [];
    let bytes = 0;
    let settled = false;
    const fail = (message: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill('SIGKILL');
      execFile(
        'docker',
        ['--context', 'colima', 'rm', '-f', invocation.name],
        { env, timeout: 10000 },
        () => reject(new Error(message))
      );
    };
    const timer = setTimeout(
      () => fail('Isolated job wall-clock limit'),
      invocation.timeoutMs
    );
    child.stdout.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > invocation.maxOutputBytes) fail('Output budget exceeded');
      else chunks.push(chunk);
    });
    // Drain diagnostics but never forward arbitrary worker stderr into logs.
    child.stderr.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > invocation.maxOutputBytes) fail('Output budget exceeded');
    });
    child.on('error', () => fail('Local sandbox executor unavailable'));
    child.stdin.on('error', () => {
      /* Early rejection is reported through exit/timeout. */
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        code: code ?? 1,
        stdout: Buffer.concat(chunks).toString('utf8'),
        wallMs: performance.now() - started,
      });
    });
    child.stdin.end(invocation.input);
  });
}
