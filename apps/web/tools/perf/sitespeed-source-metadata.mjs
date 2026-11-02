import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const RELEVANT = [
  '.',
  ':(exclude,glob)**/output/**',
  ':(exclude,glob)**/.playwright-cli/**',
];

function readGitOutput(root, args) {
  return new Promise((resolveOutput, reject) => {
    const chunks = [];
    const child = spawn('git', ['-C', root, ...args], {
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    child.stdout.on('data', (chunk) => chunks.push(chunk));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolveOutput(Buffer.concat(chunks));
      } else {
        reject(new Error(`git ${args[0]} exited ${code}`));
      }
    });
  });
}

function streamDiffHash(root) {
  return new Promise((resolveHash, reject) => {
    const hash = createHash('sha256');
    const child = spawn('git', [
      '-C',
      root,
      'diff',
      '--no-ext-diff',
      '--binary',
      'HEAD',
      '--',
      ...RELEVANT,
    ]);
    child.stdout.on('data', (chunk) => hash.update(chunk));
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0
        ? resolveHash(hash.digest('hex'))
        : reject(new Error(`git diff exited ${code}`))
    );
  });
}

export async function gitMetadata(cwd) {
  const read = async (args) => {
    return (await execFileAsync('git', args, { cwd })).stdout;
  };
  const root = (await read(['rev-parse', '--show-toplevel'])).trim();
  const trackedDiffHash = await streamDiffHash(root);
  const status = (
    await readGitOutput(root, [
      'status',
      '--porcelain',
      '--untracked-files=all',
      '--',
      ...RELEVANT,
    ])
  ).toString('utf8');
  const untracked = (
    await readGitOutput(root, [
      'ls-files',
      '--others',
      '--exclude-standard',
      '-z',
      '--',
      ...RELEVANT,
    ])
  )
    .toString('utf8')
    .split('\0')
    .filter(Boolean);
  const hash = createHash('sha256').update(trackedDiffHash);
  for (const path of untracked.sort()) {
    const bytes = readFileSync(resolve(root, path));
    hash
      .update(path)
      .update('\0')
      .update(String(bytes.length))
      .update('\0')
      .update(bytes);
  }
  return {
    sha: (await read(['rev-parse', 'HEAD'])).trim() || 'unavailable',
    dirty: Boolean(status.trim()),
    version: (await read(['--version'])).trim() || 'unavailable',
    diffHash: hash.digest('hex'),
  };
}

export const getSourceMetadata = gitMetadata;
