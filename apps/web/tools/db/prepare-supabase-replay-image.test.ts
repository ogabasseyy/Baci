import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, expect, it } from 'vitest';

const script = resolve(
  '../../.github/scripts/prepare-supabase-replay-image.sh'
);
const pins = [
  [
    'postgres',
    '17.6.1.106',
    'sha256:5e52ca81790ae3aa1c2f8c20df41dd96404c8ab29632dddf113b881de785ee92',
  ],
  [
    'realtime',
    'v2.86.3',
    'sha256:630c1f1e1443762c100147decca9cf87afe52f22a8a96d30fe7d8782741f19fb',
  ],
  [
    'storage-api',
    'v1.54.1',
    'sha256:6395ec6600b89e8133ae65e2b203d04f37a24d3626144ea2cb21973bfaa2471c',
  ],
  [
    'gotrue',
    'v2.188.1',
    'sha256:61f1099e790c4f364b70d6fb92cc07e5f90275abf2cf690ff045c63f1d96ee4b',
  ],
] as const;
function pull(index: number, registry = 'public.ecr.aws') {
  const [name, , digest] = pins[index];
  return `pull --platform linux/amd64 ${registry}/supabase/${name}@${digest}`;
}
function tag(index: number, registry = 'public.ecr.aws') {
  const [name, version, digest] = pins[index];
  return `tag ${registry}/supabase/${name}@${digest} public.ecr.aws/supabase/${name}:${version}`;
}
const successful = pins.flatMap((_, index) => [pull(index), tag(index)]);
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

function run(
  options: {
    primaryFails?: boolean;
    allFail?: boolean;
    version?: string;
    primaryFailImage?: string;
    allFailImage?: string;
    tagFailImage?: string;
  } = {}
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
  case "$4" in *"$TEST_ALL_FAIL_IMAGE"*) [ -n "$TEST_ALL_FAIL_IMAGE" ] && exit 1;; esac
  case "$4" in public.ecr.aws/*)
    [ "$TEST_PRIMARY_FAIL" = 1 ] && exit 1
    case "$4" in *"$TEST_PRIMARY_FAIL_IMAGE"*) [ -n "$TEST_PRIMARY_FAIL_IMAGE" ] && exit 1;; esac
  esac
fi
if [ "$1" = tag ] && [ -n "$TEST_TAG_FAIL_IMAGE" ]; then
  case "$2" in *"$TEST_TAG_FAIL_IMAGE"*) exit 1;; esac
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
      TEST_PRIMARY_FAIL_IMAGE: options.primaryFailImage ?? '',
      TEST_ALL_FAIL_IMAGE: options.allFailImage ?? '',
      TEST_TAG_FAIL_IMAGE: options.tagFailImage ?? '',
    },
  });
  return {
    status: result.status,
    commands: readFileSync(log, 'utf8').trim().split('\n').filter(Boolean),
  };
}

it('preloads every database schema initialization image before succeeding', () => {
  expect(run()).toEqual({ status: 0, commands: successful });
});
it('recovers primary registry failure independently for every pinned image', () => {
  expect(run({ primaryFails: true })).toEqual({
    status: 0,
    commands: pins.flatMap((_, index) => [
      pull(index),
      pull(index, 'docker.io'),
      tag(index, 'docker.io'),
    ]),
  });
});
it('recovers a later initialization image primary failure', () => {
  expect(run({ primaryFailImage: 'storage-api' })).toEqual({
    status: 0,
    commands: [
      ...successful.slice(0, 4),
      pull(2),
      pull(2, 'docker.io'),
      tag(2, 'docker.io'),
      ...successful.slice(6),
    ],
  });
});
it('fails closed without tagging when both registries fail', () => {
  expect(run({ allFail: true })).toEqual({
    status: 1,
    commands: [pull(0), pull(0, 'docker.io')],
  });
});
it('does not report partial preparation as success when a later image is unavailable', () => {
  expect(run({ allFailImage: 'storage-api' })).toEqual({
    status: 1,
    commands: [...successful.slice(0, 4), pull(2), pull(2, 'docker.io')],
  });
});
it('stops on a tag failure instead of claiming a complete cache', () => {
  expect(run({ tagFailImage: 'realtime' })).toEqual({
    status: 1,
    commands: successful.slice(0, 4),
  });
});
it('refuses a changed CLI pin before pulling an incompatible image', () => {
  expect(run({ version: '2.117.0' })).toEqual({ status: 1, commands: [] });
});
