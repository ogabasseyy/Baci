import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

function runOneColdCliProcess(manifestJson: string): Promise<number> {
  const pkgRoot = path.resolve(import.meta.dirname, '../..');
  const distCli = path.join(pkgRoot, 'dist/cli.mjs');
  const srcCli = path.join(pkgRoot, 'src/cli.ts');
  const args = existsSync(distCli) ? [distCli] : ['--import', 'tsx', srcCli];

  return new Promise((resolve, reject) => {
    const start = performance.now();
    const child = spawn(process.execPath, args, {
      cwd: pkgRoot,
      stdio: ['pipe', 'ignore', 'pipe'],
    });
    const errChunks: Buffer[] = [];
    child.stderr.on('data', (chunk: Buffer) => errChunks.push(chunk));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(
          new Error(
            `Cold CLI benchmark exited ${code}: ${Buffer.concat(errChunks).toString('utf8')}`
          )
        );
        return;
      }
      resolve(performance.now() - start);
    });
    child.stdin.end(manifestJson);
  });
}

export async function measureColdCliProcessSamples(
  manifestJson: string,
  iterations: number
): Promise<number[]> {
  const samples: number[] = [];
  for (let i = 0; i < iterations; i++) {
    samples.push(await runOneColdCliProcess(manifestJson));
  }
  return samples;
}
