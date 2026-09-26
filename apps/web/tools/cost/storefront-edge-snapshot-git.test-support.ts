import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export async function snapshotGit(repoRoot: string, ...args: string[]) {
  const { stdout } = await execFileAsync('git', [
    '-C',
    repoRoot,
    '-c',
    'core.hooksPath=/dev/null',
    '-c',
    'commit.gpgsign=false',
    '-c',
    'user.name=Snapshot Test',
    '-c',
    'user.email=snapshot@example.invalid',
    ...args,
  ]);
  return stdout.trim();
}
