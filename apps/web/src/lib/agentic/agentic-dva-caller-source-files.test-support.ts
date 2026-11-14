import { execFileSync } from 'node:child_process';
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
} from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';

export interface DvaSourceFile {
  path: string;
  source: string;
}

const sourceExtensions = ['js', 'mjs', 'ts', 'tsx'] as const;
const testSourcePattern = /\.(?:test|spec)\.[cm]?[jt]sx?$/;

export function collectDvaSourceFiles(root: string): DvaSourceFile[] {
  const rootPath = realpathSync(root);
  const paths = execFileSync(
    'git',
    [
      'ls-files',
      '--cached',
      '--others',
      '--exclude-standard',
      '-z',
      '--',
      ...sourceExtensions.map((extension) => `*.${extension}`),
    ],
    { cwd: root, maxBuffer: 64 * 1024 * 1024 }
  )
    .toString('utf8')
    .split('\0')
    .filter((path) => path && !testSourcePattern.test(path))
    .sort();

  return paths.flatMap((path) => {
    const absolutePath = resolve(root, path);
    let fileStat: ReturnType<typeof lstatSync>;
    try {
      fileStat = lstatSync(absolutePath);
    } catch (error) {
      if (
        error instanceof Error &&
        'code' in error &&
        (error.code === 'ENOENT' || error.code === 'ENOTDIR')
      )
        return [];
      throw error;
    }
    if (fileStat.isSymbolicLink())
      throw new Error('DVA source inventory contains symlink');
    if (!fileStat.isFile())
      throw new Error('DVA source inventory contains non-file');

    const resolvedPath = realpathSync(absolutePath);
    const resolvedRelativePath = relative(rootPath, resolvedPath);
    if (
      resolvedRelativePath === '..' ||
      resolvedRelativePath.startsWith(`..${sep}`) ||
      isAbsolute(resolvedRelativePath)
    )
      throw new Error('DVA source inventory path escapes repository');

    const descriptor = openSync(
      absolutePath,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)
    );
    try {
      if (!fstatSync(descriptor).isFile())
        throw new Error('DVA source inventory contains non-file');
      return [{ path, source: readFileSync(descriptor, 'utf8') }];
    } finally {
      closeSync(descriptor);
    }
  });
}
