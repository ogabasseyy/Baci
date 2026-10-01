import { execFileSync } from 'node:child_process';

const TRUSTED_GIT = '/usr/bin/git';
const HELD_GIT =
  'import os,sys\nos.fchdir(3)\nos.execv("/usr/bin/git", ["git", *sys.argv[2:]])';
function trustedGitEnvironment() {
  const env = {
    PATH: '/usr/bin:/bin',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_ATTR_NOSYSTEM: '1',
    GIT_TERMINAL_PROMPT: '0',
    GIT_NO_REPLACE_OBJECTS: '1',
    GIT_NO_LAZY_FETCH: '1',
  };
  for (const key of ['HOME', 'LANG', 'LC_ALL', 'TZ']) {
    if (typeof process.env[key] === 'string') env[key] = process.env[key];
  }
  return env;
}

export function git(cwd, args, input, encoding = 'utf8') {
  const guarded =
    typeof cwd === 'object' && cwd !== null && typeof cwd.path === 'string'
      ? cwd
      : { path: cwd };
  guarded.guard?.();
  try {
    const options = {
      cwd: guarded.path,
      encoding,
      input,
      env: trustedGitEnvironment(),
      timeout: 120_000,
      maxBuffer: 512 * 1024 * 1024,
    };
    let executable = TRUSTED_GIT;
    let commandArgs = args;
    if (Number.isSafeInteger(guarded.fd)) {
      executable = '/usr/bin/python3';
      commandArgs = ['-I', '-S', '-E', '-c', HELD_GIT, 'git', ...args];
      options.cwd = '/';
      options.stdio = ['pipe', 'pipe', 'pipe', guarded.fd];
    }
    const result = execFileSync(executable, commandArgs, options);
    guarded.guard?.();
    return result;
  } catch (error) {
    guarded.guard?.();
    throw error;
  }
}
