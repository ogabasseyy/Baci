import { readFileSync } from 'node:fs';
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { expectedSupabaseReplayResources } from './supabase-replay-expected-resources';
import {
  SUPABASE_REPLAY_IMAGE_PINS,
  writeSupabaseReplayImagePins,
} from './supabase-replay-image-pins';

const IMAGE_SCRIPT = path.resolve(
  process.cwd(),
  '../../.github/scripts/prepare-supabase-replay-image.sh'
);
// Image name in the CI script -> the pin file the Supabase CLI reads for that service.
const PIN_FILE_BY_IMAGE = {
  gotrue: 'gotrue-version',
  postgres: 'postgres-version',
  realtime: 'realtime-version',
  'storage-api': 'storage-version',
} as const;

const workdirs: string[] = [];
async function makeWorkdir(): Promise<string> {
  const workdir = await mkdtemp(path.join(tmpdir(), 'baci-replay-pins-'));
  workdirs.push(workdir);
  return workdir;
}
afterEach(async () => {
  for (const workdir of workdirs.splice(0))
    await rm(workdir, { force: true, recursive: true });
});

describe('writeSupabaseReplayImagePins', () => {
  it('writes one pin file per service under supabase/.temp and nothing else', async () => {
    const workdir = await makeWorkdir();

    await writeSupabaseReplayImagePins(workdir);

    const directory = path.join(workdir, 'supabase', '.temp');
    expect((await readdir(directory)).sort()).toEqual(
      Object.keys(SUPABASE_REPLAY_IMAGE_PINS).sort()
    );
    for (const [file, tag] of Object.entries(SUPABASE_REPLAY_IMAGE_PINS)) {
      expect((await readFile(path.join(directory, file), 'utf8')).trim()).toBe(
        tag
      );
    }
  });

  it('keeps the pins private to the replay user', async () => {
    const workdir = await makeWorkdir();

    await writeSupabaseReplayImagePins(workdir);

    const directory = path.join(workdir, 'supabase', '.temp');
    expect((await stat(directory)).mode & 0o777).toBe(0o700);
    for (const file of Object.keys(SUPABASE_REPLAY_IMAGE_PINS)) {
      expect((await stat(path.join(directory, file))).mode & 0o777).toBe(0o600);
    }
  });

  it('replaces a stale pin instead of keeping a newer default', async () => {
    const workdir = await makeWorkdir();
    const directory = path.join(workdir, 'supabase', '.temp');
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, 'postgres-version'), '17.11.0.018');

    await writeSupabaseReplayImagePins(workdir);

    expect(
      (await readFile(path.join(directory, 'postgres-version'), 'utf8')).trim()
    ).toBe(SUPABASE_REPLAY_IMAGE_PINS['postgres-version']);
  });
});

describe('SUPABASE_REPLAY_IMAGE_PINS', () => {
  it('names exactly the tags of the digest-pinned images the CI script prepares', () => {
    const prepared = [
      ...readFileSync(IMAGE_SCRIPT, 'utf8').matchAll(
        /^\s*'([a-z-]+):([^@']+)@sha256:[0-9a-f]{64}'$/gm
      ),
    ].map(([, name, tag]) => [name, tag]);

    expect(Object.fromEntries(prepared)).toEqual(
      Object.fromEntries(
        Object.entries(PIN_FILE_BY_IMAGE).map(([image, file]) => [
          image,
          SUPABASE_REPLAY_IMAGE_PINS[file],
        ])
      )
    );
  });

  it('selects the database image the resource check expects', () => {
    const [database] = expectedSupabaseReplayResources(
      {},
      'replay-project'
    ).containers;

    expect(database?.image).toBe(
      `public.ecr.aws/supabase/postgres:${SUPABASE_REPLAY_IMAGE_PINS['postgres-version']}`
    );
  });

  it('uses tags the CLI accepts, with exactly one v prefix on the service images', () => {
    // CLI 3.x adds a missing v to gotrue, storage and realtime tags and rejects a doubled one.
    for (const file of [
      'gotrue-version',
      'realtime-version',
      'storage-version',
    ] as const) {
      expect(SUPABASE_REPLAY_IMAGE_PINS[file]).toMatch(/^v\d+\.\d+\.\d+$/);
    }
    expect(SUPABASE_REPLAY_IMAGE_PINS['postgres-version']).toMatch(
      /^\d+\.\d+\.\d+\.\d+$/
    );
    for (const tag of Object.values(SUPABASE_REPLAY_IMAGE_PINS)) {
      expect(tag).toMatch(/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/);
    }
  });
});
