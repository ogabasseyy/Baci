import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * The service image tags every replay runs, whichever Supabase CLI release starts them.
 *
 * A CLI release moves its built-in defaults (CLI 3.1.0 defaults to PostgreSQL 17.11, while the replay and
 * the committed production fixture are built for 17.6, server_version_num 170006), so the replay writes
 * these tags into the CLI's own pin files, `supabase/.temp/<service>-version`, before `db start`. They are
 * the images CLI 2.111.0 shipped as defaults.
 *
 * Keep them in lockstep with the digest-pinned images that
 * .github/scripts/prepare-supabase-replay-image.sh pre-pulls (supabase-replay-image-pins.test.ts checks it)
 * and with the database image supabase-replay-expected-resources.ts expects.
 */
export const SUPABASE_REPLAY_IMAGE_PINS = {
  'gotrue-version': 'v2.194.0',
  'postgres-version': '17.6.1.156',
  'realtime-version': 'v2.120.3',
  'storage-version': 'v1.67.20',
} as const;

export async function writeSupabaseReplayImagePins(
  workdir: string
): Promise<void> {
  const directory = path.join(workdir, 'supabase', '.temp');
  await mkdir(directory, { mode: 0o700, recursive: true });
  for (const [file, tag] of Object.entries(SUPABASE_REPLAY_IMAGE_PINS)) {
    await writeFile(path.join(directory, file), `${tag}\n`, { mode: 0o600 });
  }
}
