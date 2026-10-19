import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, expect, it } from 'vitest';

const script = resolve(
  '../../.github/scripts/prepare-supabase-replay-image.sh'
);
const digest =
  'sha256:5e52ca81790ae3aa1c2f8c20df41dd96404c8ab29632dddf113b881de785ee92';
const primary = `public.ecr.aws/supabase/postgres@${digest}`;
const mirror = `docker.io/supabase/postgres@${digest}`;
const tag = 'public.ecr.aws/supabase/postgres:17.6.1.106';
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

function run(
  options: { primaryFails?: boolean; allFail?: boolean; version?: string } = {}
) {
  const root = mkdtempSync(join(tmpdir(), 'replay-image-'));
  roots.push(root);
  const log = join(root, 'commands');
  writeFileSync(log, '');
  writeFileSync(
    join(root, 'supabase'),
    '#!/bin/sh\nprintf "%s\\n" "$TEST_CLI_VERSION"\n',
    { mode: 0o700 }
  );
  writeFileSync(
    join(root, 'docker'),
    `#!/bin/sh
printf '%s\\n' "$*" >> "$TEST_COMMAND_LOG"
if [ "$1" = pull ]; then
  [ "$TEST_ALL_FAIL" = 1 ] && exit 1
  case "$4" in public.ecr.aws/*) [ "$TEST_PRIMARY_FAIL" = 1 ] && exit 1;; esac
fi
exit 0
`,
    { mode: 0o700 }
  );
  const result = spawnSync('bash', [script], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${root}:${process.env.PATH}`,
      TEST_COMMAND_LOG: log,
      TEST_CLI_VERSION: options.version ?? '2.95.4',
      TEST_PRIMARY_FAIL: options.primaryFails ? '1' : '0',
      TEST_ALL_FAIL: options.allFail ? '1' : '0',
    },
  });
  return {
    status: result.status,
    commands: readFileSync(log, 'utf8').trim().split('\n').filter(Boolean),
  };
}

it('preloads the pinned primary image under the tag the CLI actually uses', () => {
  expect(run()).toEqual({
    status: 0,
    commands: [
      `pull --platform linux/amd64 ${primary}`,
      `tag ${primary} ${tag}`,
    ],
  });
});
it('recovers a primary pull failure using the identical mirror digest', () => {
  expect(run({ primaryFails: true })).toEqual({
    status: 0,
    commands: [
      `pull --platform linux/amd64 ${primary}`,
      `pull --platform linux/amd64 ${mirror}`,
      `tag ${mirror} ${tag}`,
    ],
  });
});
it('fails closed without tagging when both registries fail', () => {
  expect(run({ allFail: true })).toEqual({
    status: 1,
    commands: [
      `pull --platform linux/amd64 ${primary}`,
      `pull --platform linux/amd64 ${mirror}`,
    ],
  });
});
it('refuses a changed CLI pin before pulling an incompatible image', () => {
  expect(run({ version: '2.117.0' })).toEqual({ status: 1, commands: [] });
});
