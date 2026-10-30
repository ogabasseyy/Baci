import { execFile } from 'node:child_process';
import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, sep } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/i;

const gitWithoutHooksOrSigning = (args: string[]) =>
  execFileAsync('git', [
    '-c',
    'core.hooksPath=/dev/null',
    '-c',
    'commit.gpgsign=false',
    ...args,
  ]);

/** Creates a genuine local clone with its own Git metadata and physical dependencies. */
export async function createContainedEvidenceDependencyWorkspace(
  workspaceRoot: string,
  packageNames: readonly string[]
) {
  if (
    !Array.isArray(packageNames) ||
    packageNames.some(
      (name) =>
        typeof name !== 'string' ||
        name.length > 214 ||
        !PACKAGE_NAME.test(name)
    )
  )
    throw new Error('dependency fixture package name is invalid');
  const root = await mkdtemp(
    join(await realpath(tmpdir()), 'baci-evidence-workspace-')
  );
  try {
    const { stdout: head } = await execFileAsync(
      'git',
      ['-C', workspaceRoot, 'rev-parse', '--verify', 'HEAD'],
      { encoding: 'utf8' }
    );
    await gitWithoutHooksOrSigning([
      'clone',
      '--quiet',
      '--shared',
      '--no-hardlinks',
      '--no-checkout',
      workspaceRoot,
      root,
    ]);
    await gitWithoutHooksOrSigning([
      '-C',
      root,
      'checkout',
      '--quiet',
      '--detach',
      head.trim(),
    ]);
    const [{ stdout: clonedHead }, { stdout: cloneStatus }, cloneGitDirectory] =
      await Promise.all([
        execFileAsync('git', ['-C', root, 'rev-parse', '--verify', 'HEAD'], {
          encoding: 'utf8',
        }),
        execFileAsync(
          'git',
          ['-C', root, 'status', '--porcelain', '--untracked-files=all'],
          { encoding: 'utf8' }
        ),
        execFileAsync('git', ['-C', root, 'rev-parse', '--absolute-git-dir'], {
          encoding: 'utf8',
        }),
      ]);
    const callerGitDirectory = await execFileAsync(
      'git',
      ['-C', workspaceRoot, 'rev-parse', '--absolute-git-dir'],
      { encoding: 'utf8' }
    );
    const cloneGitPath = cloneGitDirectory.stdout.trim();
    const callerGitPath = callerGitDirectory.stdout.trim();
    const cloneGitStat = await lstat(cloneGitPath);
    if (
      clonedHead.trim() !== head.trim() ||
      cloneStatus ||
      cloneGitPath === callerGitPath ||
      !cloneGitStat.isDirectory()
    )
      throw new Error(
        'dependency fixture clone is not independent at real HEAD'
      );

    await mkdir(join(root, 'node_modules', '.bin'), { recursive: true });
    for (const packageName of packageNames) {
      const source = await realpath(
        join(workspaceRoot, 'node_modules', packageName)
      );
      const destination = join(root, 'node_modules', packageName);
      await mkdir(destination, { recursive: true });
      await cp(source, destination, { recursive: true, dereference: true });
      const copied = await realpath(destination);
      const copiedRelative = relative(root, copied);
      if (
        !copiedRelative ||
        copiedRelative === '..' ||
        copiedRelative.startsWith(`..${sep}`) ||
        isAbsolute(copiedRelative)
      )
        throw new Error('dependency fixture package escaped its clone');
    }
    await symlink(
      '../tsx/dist/cli.mjs',
      join(root, 'node_modules', '.bin', 'tsx')
    );
    return { root, cleanup: () => rm(root, { recursive: true, force: true }) };
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }
}
