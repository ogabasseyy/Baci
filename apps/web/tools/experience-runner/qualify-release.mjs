import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
/** @returns {Array<[string, string[]]>} */
export function experienceReleaseCommands() {
  return [
    [
      'pnpm',
      [
        '--config.verify-deps-before-run=false',
        '--workspace-root',
        'turbo',
        'lint',
      ],
    ],
    [
      'pnpm',
      [
        '--config.verify-deps-before-run=false',
        '--workspace-root',
        'turbo',
        'typecheck',
      ],
    ],
    [
      'pnpm',
      [
        '--config.verify-deps-before-run=false',
        '--workspace-root',
        'turbo',
        'test',
      ],
    ],
    ['node', ['tools/experience-sql/run.mjs']],
    ['node', ['experience-runtime/build.mjs']],
    [
      'pnpm',
      [
        '--config.verify-deps-before-run=false',
        'exec',
        'vitest',
        'run',
        '--config',
        'vitest.experience-lifecycle.config.ts',
      ],
    ],
    [
      'pnpm',
      [
        '--config.verify-deps-before-run=false',
        '--filter',
        '@baci/experience-sdk',
        'build',
      ],
    ],
    [
      'pnpm',
      [
        '--config.verify-deps-before-run=false',
        'exec',
        'vitest',
        'run',
        '--config',
        'vitest.experience-runner.config.ts',
      ],
    ],
    [
      'pnpm',
      [
        '--config.verify-deps-before-run=false',
        'exec',
        'playwright',
        'test',
        '--config',
        'tests/experience-browser/playwright.config.ts',
      ],
    ],
  ];
}
export function experienceReleaseEnvironment() {
  const allowed = [
    'PATH',
    'HOME',
    'LANG',
    'TMPDIR',
    'SHELL',
    'TERM',
    'BACI_BUILDER_LOCAL_PG_BIN',
  ];
  const env = Object.fromEntries(
    allowed.filter((k) => process.env[k]).map((k) => [k, process.env[k]])
  );
  Object.assign(env, {
    NODE_ENV: 'test',
    BACI_BUILDER_LOCAL_PG: '1',
    BACI_BUILDER_LOCAL_PG_MAJOR: '17',
    DO_NOT_TRACK: '1',
    TURBO_TELEMETRY_DISABLED: '1',
  });
  if (!env.BACI_BUILDER_LOCAL_PG_BIN && process.platform === 'darwin')
    env.BACI_BUILDER_LOCAL_PG_BIN = '/opt/homebrew/opt/postgresql@17/bin';
  return env;
}
export function runExperienceRelease() {
  const env = experienceReleaseEnvironment();
  for (const [command, args] of experienceReleaseCommands()) {
    const r = spawnSync(command, args, { env, stdio: 'inherit' });
    if (r.status !== 0) return r.status ?? 1;
  }
  return 0;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  process.exitCode = runExperienceRelease();
