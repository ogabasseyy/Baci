import { afterEach, expect, it, vi } from 'vitest';
import {
  experienceReleaseCommands,
  experienceReleaseEnvironment,
} from './qualify-release.mjs';

afterEach(() => vi.unstubAllEnvs());
it('explicit release corpus includes monorepo,SQL,lifecycle,portable runner and non-skippable browsers', () => {
  const commands = experienceReleaseCommands()
    .map(([command, args]) => `${command} ${args.join(' ')}`)
    .join('\n');
  for (const gate of [
    'turbo lint',
    'turbo typecheck',
    'turbo test',
    'experience-sql/run.mjs',
    'vitest.experience-lifecycle.config.ts',
    'experience-runtime/build.mjs',
    'vitest.experience-runner.config.ts',
    'tests/experience-browser/playwright.config.ts',
  ])
    expect(commands).toContain(gate);
  expect(commands).not.toMatch(
    /--passWithNoTests|--grep|--last-failed|--retries|deploy|publish|curl|npm install/
  );
});
it('release subprocess environment excludes provider,production and service-role credentials', () => {
  vi.stubEnv('OPENAI_API_KEY', 'forbidden');
  vi.stubEnv('ANTHROPIC_API_KEY', 'forbidden');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'forbidden');
  vi.stubEnv('DATABASE_URL', 'forbidden');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://production.invalid');
  const env = experienceReleaseEnvironment();
  expect(JSON.stringify(env)).not.toContain('forbidden');
  expect(JSON.stringify(env)).not.toContain('production.invalid');
  expect(env.BACI_BUILDER_LOCAL_PG).toBe('1');
  expect(env.NODE_ENV).toBe('test');
});

it('forces every monorepo gate to the workspace root when invoked from the web package', () => {
  for (const [command, args] of experienceReleaseCommands()) {
    if (command === 'pnpm' && args.includes('turbo'))
      expect(args).toContain('--workspace-root');
  }
});

it('prepares current runner workers before lifecycle tests can execute them', () => {
  const commands = experienceReleaseCommands().map(([, args]) =>
    args.join(' ')
  );
  const build = commands.findIndex((args) =>
    args.includes('experience-runtime/build.mjs')
  );
  const lifecycle = commands.findIndex((args) =>
    args.includes('vitest.experience-lifecycle.config.ts')
  );
  expect(build).toBeGreaterThanOrEqual(0);
  expect(lifecycle).toBeGreaterThan(build);
});
