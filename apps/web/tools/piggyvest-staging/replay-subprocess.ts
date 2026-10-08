import { execFile } from 'node:child_process';
import { parseReplaySummary } from './schemas/replay-summary';

export function runReplaySubprocess(
  script: string,
  signal: AbortSignal,
  report: (summary: ReturnType<typeof parseReplaySummary>) => void = () =>
    undefined
): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      [script, '--pass'],
      {
        timeout: 90_000,
        killSignal: 'SIGKILL',
        maxBuffer: 64 * 1024,
        signal,
      },
      (error, stdout) => {
        try {
          report(parseReplaySummary(stdout));
          if (error) throw new Error('Child failed');
          resolve();
        } catch {
          reject(new Error('Staging replay subprocess failed'));
        }
      }
    );
  });
}
